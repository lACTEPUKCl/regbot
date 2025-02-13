import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import getCommands from "./commands/getCommands.js";
import { getCollection } from "./utils/mongodb.js";
import { config } from "dotenv";
import { restoreTimers } from "./utils/restoreTimers.js";
import { updateEventEmbed } from "./utils/updateEventEmbed.js";
import getSteamId64 from "./utils/getSteamID64.js";
config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Инициализация коллекции команд
client.commands = new Collection();
const commands = await getCommands();
for (const command of commands) {
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log("The command is missing 'data' or 'execute' property.");
  }
}

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await restoreTimers(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Обработка slash-команд
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "There was an error while executing this command!",
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: "There was an error while executing this command!",
            ephemeral: true,
          });
        }
      }
      return;
    }

    // Обработка кнопок
    else if (interaction.isButton()) {
      // Обработка кнопки регистрации (customId начинается с "register_")
      if (interaction.customId.startsWith("register_")) {
        const eventsCollection = await getCollection("events");
        const eventId = interaction.message.id;
        const currentEvent = await eventsCollection.findOne({ eventId });

        if (!currentEvent) {
          await interaction.reply({
            content: "Это событие больше не существует.",
            ephemeral: true,
          });
          return;
        }

        const userId = interaction.user.id;
        const alreadyRegistered = currentEvent.teams.some((team) =>
          team.members.some((member) => member.userId === userId)
        );
        const isSubstitute =
          currentEvent.substitutes &&
          currentEvent.substitutes.some((sub) => sub.userId === userId);

        if (alreadyRegistered || isSubstitute) {
          await interaction.reply({
            content: alreadyRegistered
              ? "Вы уже зарегистрированы в команде."
              : "Вы уже находитесь в списке запасных.",
            ephemeral: true,
          });
          return;
        }

        // Формирование списка доступных команд
        const maxPlayersPerTeam = currentEvent.maxPlayersPerTeam || Infinity;
        const availableTeams = currentEvent.teams.filter((team) => {
          const currentPlayers = team.members.reduce(
            (acc, member) => acc + (member.numberPlayers || 1), // Считаем всех игроков, учитывая число игроков в каждой записи
            0
          );
          const freeSlots = maxPlayersPerTeam - currentPlayers;
          return freeSlots > 0; // Если есть хотя бы одно свободное место, команда доступна
        });

        const teamOptions = availableTeams.map((team) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(team.name)
            .setValue(team.name)
        );
        // Добавляем опцию для запасных
        teamOptions.push(
          new StringSelectMenuOptionBuilder()
            .setLabel("Скамья запасных")
            .setValue("substitutes")
        );

        const teamSelectMenu = new StringSelectMenuBuilder()
          // Передаём eventId в customId, чтобы знать, к какому событию относится выбор
          .setCustomId(`team_select_menu_${eventId}`)
          .setPlaceholder("Выберите команду")
          .addOptions(teamOptions);

        const actionRow = new ActionRowBuilder().addComponents(teamSelectMenu);

        await interaction.reply({
          content: "Выберите команду для регистрации:",
          components: [actionRow],
          ephemeral: true,
        });
        return;
      }
      // Обработка кнопок подтверждения/отмены в DM (customId: confirmDM_userId_teamName или cancelDM_userId_teamName)
      else if (
        interaction.customId.startsWith("confirmDM_") ||
        interaction.customId.startsWith("cancelDM_")
      ) {
        // … существующий код обработки confirmDM/cancelDM без изменений …
        const parts = interaction.customId.split("_");
        if (parts.length < 3) {
          await interaction.reply({
            content: "Неверный формат команды.",
            ephemeral: true,
          });
          return;
        }
        const action = parts[0]; // confirmDM или cancelDM
        const userId = parts[1];
        const teamName = parts.slice(2).join("_");

        const eventsCollection = await getCollection("events");
        const notificationsCollection = await getCollection("notifications");

        const notification = await notificationsCollection.findOne({
          userId,
          teamName,
          status: "pending",
        });

        if (notification && notification.channelId && notification.messageId) {
          try {
            const dmChannel = await interaction.client.channels.fetch(
              notification.channelId
            );
            if (dmChannel) {
              const dmMessage = await dmChannel.messages
                .fetch(notification.messageId)
                .catch(() => null);
              if (dmMessage) {
                await dmMessage.delete();
                console.log(`DM-сообщение ${notification.messageId} удалено.`);
              }
            }
          } catch (err) {
            console.error("Ошибка при удалении DM-сообщения:", err);
          }
        }

        if (action === "confirmDM") {
          if (notification && notification.eventId) {
            const event = await eventsCollection.findOne({
              eventId: notification.eventId,
            });
            if (event) {
              await updateEventEmbed(interaction.client, event);
              console.log(
                `Эмбед события ${event.eventId} обновлён (confirmDM).`
              );
            }
          }
          await notificationsCollection.deleteOne({
            userId,
            teamName,
            status: "pending",
          });
          await interaction.reply({
            content: `Вы подтвердили участие в команде ${teamName}.`,
            ephemeral: true,
          });
          console.log(
            `Игрок ${userId} подтвердил участие в команде ${teamName}.`
          );
        } else if (action === "cancelDM") {
          const event = await eventsCollection.findOne({
            "teams.name": teamName,
          });
          if (!event) {
            await interaction.reply({
              content: `Событие для команды ${teamName} не найдено.`,
              ephemeral: true,
            });
            return;
          }
          let userRemoved = false;
          for (const team of event.teams) {
            if (team.name === teamName) {
              const initialCount = team.members.length;
              team.members = team.members.filter((m) => m.userId !== userId);
              if (team.members.length < initialCount) {
                userRemoved = true;
                console.log(
                  `Пользователь ${userId} удалён из команды ${teamName}.`
                );
              }
            }
          }
          if (!userRemoved) {
            await interaction.reply({
              content: "Вы не были зарегистрированы в этой команде.",
              ephemeral: true,
            });
            return;
          }
          const updateResult = await eventsCollection.updateOne(
            { eventId: event.eventId },
            { $set: { teams: event.teams } }
          );
          if (updateResult.modifiedCount === 0) {
            await interaction.reply({
              content: "Не удалось обновить данные о событии в базе данных.",
              ephemeral: true,
            });
            return;
          }
          await notificationsCollection.deleteOne({
            userId,
            teamName,
            eventId: event.eventId,
            status: "pending",
          });
          console.log("Уведомление после отмены удалено.");
          const updatedEvent = await eventsCollection.findOne({
            eventId: event.eventId,
          });
          if (updatedEvent) {
            await updateEventEmbed(interaction.client, updatedEvent);
            console.log(`Эмбед события ${event.eventId} обновлён (cancelDM).`);
          }
          await interaction.reply({
            content: `Вы отменили участие в команде ${teamName}.`,
            ephemeral: true,
          });
        }
        return;
      }
      // Обработка кнопки отмены регистрации (customId начинается с "cancel_")
      else if (interaction.customId.startsWith("cancel_")) {
        const eventsCollection = await getCollection("events");
        const eventId = interaction.message.id;
        const event = await eventsCollection.findOne({ eventId });
        if (!event) {
          await interaction.reply({
            content: "Это событие больше не существует.",
            ephemeral: true,
          });
          return;
        }

        const userId = interaction.user.id;
        let removed = false;
        event.teams.forEach((team) => {
          const index = team.members.findIndex(
            (member) => member.userId === userId
          );
          if (index !== -1) {
            team.members.splice(index, 1);
            removed = true;
          }
        });
        if (event.substitutes) {
          const subIndex = event.substitutes.findIndex(
            (sub) => sub.userId === userId
          );
          if (subIndex !== -1) {
            event.substitutes.splice(subIndex, 1);
            removed = true;
          }
        }

        if (!removed) {
          await interaction.reply({
            content:
              "Вы не зарегистрированы ни в одной команде и не находитесь в списке запасных.",
            ephemeral: true,
          });
          return;
        }

        await eventsCollection.updateOne(
          { eventId: event.eventId },
          { $set: { teams: event.teams, substitutes: event.substitutes } }
        );
        await updateEventEmbed(client, event);
        await interaction.reply({
          content: "Ваша регистрация была успешно отменена.",
          ephemeral: true,
        });
        return;
      }
    }
    // Обработка выбора команды из меню (select menu)
    else if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("team_select_menu_")
    ) {
      // customId имеет формат: "team_select_menu_{eventId}"
      const customIdParts = interaction.customId.split("_");
      if (customIdParts.length < 4) {
        await interaction.reply({
          content: "Неверный формат команды выбора.",
          ephemeral: true,
        });
        return;
      }
      const eventId = customIdParts.slice(3).join("_");
      const selectedTeam = interaction.values[0];

      const eventsCollection = await getCollection("events");
      const currentEvent = await eventsCollection.findOne({ eventId });
      if (!currentEvent) {
        await interaction.reply({
          content: "Событие не найдено.",
          ephemeral: true,
        });
        return;
      }

      const userId = interaction.user.id;
      const alreadyRegistered = currentEvent.teams.some((team) =>
        team.members.some((member) => member.userId === userId)
      );
      if (alreadyRegistered) {
        await interaction.reply({
          content: "Вы уже зарегистрированы в команде.",
          ephemeral: true,
        });
        return;
      }

      // В зависимости от типа ивента показываем разные модальные окна
      if (currentEvent.eventType === "clan") {
        const modal = new ModalBuilder()
          .setCustomId(`register_modal_${selectedTeam}_${eventId}`)
          .setTitle("Регистрация на турнир");
        const steamIdInput = new TextInputBuilder()
          .setCustomId("steamid_input")
          .setLabel("Введите ссылку на профиль Steam или SteamID64")
          .setPlaceholder("Пример: https://steamcommunity.com/id/yourprofile")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const clanTagInput = new TextInputBuilder()
          .setCustomId("clan_tag_input")
          .setLabel("Введите клан тег (без скобок)")
          .setPlaceholder("Пример: ABC или XYZ")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const discordInviteInput = new TextInputBuilder()
          .setCustomId("discord_invite_input")
          .setLabel("Введите ссылку на Discord сообщество")
          .setPlaceholder("Пример: https://discord.gg/yourclan")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const numberPlayersInput = new TextInputBuilder()
          .setCustomId("number_players_input")
          .setLabel("Введите количество игроков")
          .setPlaceholder("Пример: 5")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(steamIdInput),
          new ActionRowBuilder().addComponents(clanTagInput),
          new ActionRowBuilder().addComponents(discordInviteInput),
          new ActionRowBuilder().addComponents(numberPlayersInput)
        );
        await interaction.showModal(modal);
      } else if (currentEvent.eventType === "solo") {
        const modal = new ModalBuilder()
          .setCustomId(`register_modal_${selectedTeam}_${eventId}`)
          .setTitle("Регистрация на турнир (Solo)");

        const steamIdInput = new TextInputBuilder()
          .setCustomId("steamid_input")
          .setLabel("Введите ваш Steam ID")
          .setPlaceholder("Ваш Steam ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const squadLeaderInput = new TextInputBuilder()
          .setCustomId("squad_leader_input")
          .setLabel("Хотите ли вы быть сквадным?")
          .setPlaceholder("Да/Нет")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const squadHoursInput = new TextInputBuilder()
          .setCustomId("squad_hours_input")
          .setLabel("Сколько часов вы провели в Squad?")
          .setPlaceholder("Введите количество часов")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const techSquadInput = new TextInputBuilder()
          .setCustomId("tech_squad_input")
          .setLabel("Хотите ли вы быть в отряде 'Тех'?")
          .setPlaceholder("Да/Нет")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(steamIdInput),
          new ActionRowBuilder().addComponents(squadLeaderInput),
          new ActionRowBuilder().addComponents(techSquadInput),
          new ActionRowBuilder().addComponents(squadHoursInput)
        );

        await interaction.showModal(modal);
      }
      return;
    }
    // Обработка сабмита модального окна
    else if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("register_modal_")
    ) {
      const parts = interaction.customId.split("_");
      if (parts.length < 4) {
        await interaction.reply({
          content: "Неверный формат модального окна.",
          ephemeral: true,
        });
        return;
      }
      const selectedTeam = parts[2];
      const eventId = parts.slice(3).join("_");

      const eventsCollection = await getCollection("events");
      const currentEvent = await eventsCollection.findOne({ eventId });
      if (!currentEvent) {
        await interaction.reply({
          content: "Событие не найдено. Попробуйте снова.",
          ephemeral: true,
        });
        return;
      }

      const userId = interaction.user.id;
      const steamApiKey = process.env.STEAM_API_KEY;
      const steamIdRaw = interaction.fields.getTextInputValue("steamid_input");
      const steamId = await getSteamId64(steamApiKey, steamIdRaw);
      let game;

      if (!steamId) {
        await interaction.reply({
          content:
            "Неверный Steam ID. Пожалуйста, проверьте введённые данные и попробуйте снова.",
          ephemeral: true,
        });
        return;
      }

      // Используем GetOwnedGames для получения времени в игре
      const steamApiUrl = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}&steamid=${steamId}&include_played_free_games=1`;

      let nickname;

      try {
        const response = await fetch(steamApiUrl);
        const data = await response.json();

        if (data.response && data.response.games) {
          game = data.response.games.find((game) => game.appid === 393380);
        }

        // Получаем имя игрока через GetPlayerSummaries
        const playerResponse = await fetch(
          `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamApiKey}&steamids=${steamId}`
        );
        const playerData = await playerResponse.json();

        if (
          playerData.response &&
          playerData.response.players &&
          playerData.response.players.length
        ) {
          nickname = playerData.response.players[0].personaname;
        } else {
          nickname = "Неизвестный игрок";
        }
      } catch (error) {
        console.error("Ошибка при запросе к Steam API:", error);
        nickname = "Неизвестный игрок";
      }

      // Обработка регистрации для clan-ивента
      if (currentEvent.eventType === "clan") {
        const clanTag = interaction.fields.getTextInputValue("clan_tag_input");
        const discordLink = interaction.fields.getTextInputValue(
          "discord_invite_input"
        );
        const numberPlayersRaw = interaction.fields.getTextInputValue(
          "number_players_input"
        );
        const numberPlayers = parseInt(numberPlayersRaw, 10);

        if (isNaN(numberPlayers) || numberPlayers <= 0) {
          await interaction.reply({
            content: "Пожалуйста, введите корректное количество игроков.",
            ephemeral: true,
          });
          return;
        }

        // Добавляем проверку: введённое количество не должно превышать максимальное число участников в отряде
        if (numberPlayers > currentEvent.maxPlayersPerTeam) {
          await interaction.reply({
            content: `Количество игроков не может превышать максимально возможное значение (${currentEvent.maxPlayersPerTeam}).`,
            ephemeral: true,
          });
          return;
        }

        // Если регистрация идёт в список запасных, проверку лимита можно не делать, но число игроков всё равно должно быть валидным
        if (selectedTeam === "substitutes") {
          if (!currentEvent.substitutes) {
            currentEvent.substitutes = [];
          }
          const alreadySubstitute = currentEvent.substitutes.some(
            (sub) => sub.userId === userId
          );
          if (alreadySubstitute) {
            await interaction.reply({
              content: "Вы уже находитесь в списке запасных.",
              ephemeral: true,
            });
            return;
          }
          currentEvent.substitutes.push({
            userId,
            nickname,
            steamId,
            clanTag,
            discordLink,
            numberPlayers,
          });
        } else {
          // Регистрация в конкретную команду:
          const teamIndex = currentEvent.teams.findIndex(
            (team) => team.name === selectedTeam
          );
          if (teamIndex === -1) {
            await interaction.reply({
              content: "Выбранная команда не существует.",
              ephemeral: true,
            });
            return;
          }

          // Проверяем, не зарегистрирован ли уже пользователь в любой команде
          const alreadyRegistered = currentEvent.teams.some((team) =>
            team.members.some((member) => member.userId === userId)
          );
          if (alreadyRegistered) {
            await interaction.reply({
              content: "Вы уже зарегистрированы в команде.",
              ephemeral: true,
            });
            return;
          }

          // Проверяем, не превышает ли сумма зарегистрированных игроков + новых доступное число слотов
          const currentPlayers = currentEvent.teams[teamIndex].members.reduce(
            (acc, member) => acc + (member.numberPlayers || 1),
            0
          );
          const maxPlayersPerTeam = currentEvent.maxPlayersPerTeam || Infinity;

          if (currentPlayers + numberPlayers > maxPlayersPerTeam) {
            const freeSlots = maxPlayersPerTeam - currentPlayers;
            await interaction.reply({
              content: `В команде **${selectedTeam}** осталось всего **${freeSlots}** свободных мест. Пожалуйста, укажите количество игроков не более этого значения.`,
              ephemeral: true,
            });
            return;
          }

          currentEvent.teams[teamIndex].members.push({
            userId,
            nickname,
            steamId,
            clanTag,
            discordLink,
            numberPlayers,
          });
        }

        // Обновляем данные события в базе данных и эмбед
        await eventsCollection.updateOne(
          { eventId: currentEvent.eventId },
          {
            $set: {
              teams: currentEvent.teams,
              substitutes: currentEvent.substitutes,
            },
          }
        );

        const updatedEvent = await eventsCollection.findOne({
          eventId: currentEvent.eventId,
        });
        await updateEventEmbed(client, updatedEvent);

        await interaction.reply({
          content: `Вы успешно зарегистрированы в ${
            selectedTeam === "substitutes"
              ? "списке запасных"
              : `команде ${selectedTeam}`
          }.`,
          ephemeral: true,
        });
      } else if (currentEvent.eventType === "solo") {
        const squadLeader =
          interaction.fields.getTextInputValue("squad_leader_input");
        const squadHoursRaw =
          interaction.fields.getTextInputValue("squad_hours_input");
        const techSquad =
          interaction.fields.getTextInputValue("tech_squad_input");

        let squadHours;

        // Если время было получено с Steam API, оставляем звездочки
        if (game && game.playtime_forever) {
          squadHours = `**${(game.playtime_forever / 60).toFixed(0)}**`;
        } else {
          squadHours = squadHoursRaw;
        }

        const squadHoursNumeric = parseInt(squadHours.replace(/\*\*/g, ""), 10);

        // Проверка на корректность числового значения
        if (isNaN(squadHoursNumeric) || squadHoursNumeric < 0) {
          await interaction.reply({
            content: "Пожалуйста, введите корректное количество часов.",
            ephemeral: true,
          });
          return;
        }

        // Для соло-ивента регистрируется всегда 1 игрок
        const numberPlayers = 1;

        if (selectedTeam === "substitutes") {
          if (!currentEvent.substitutes) {
            currentEvent.substitutes = [];
          }
          const alreadySubstitute = currentEvent.substitutes.some(
            (sub) => sub.userId === userId
          );
          if (alreadySubstitute) {
            await interaction.reply({
              content: "Вы уже находитесь в списке запасных.",
              ephemeral: true,
            });
            return;
          }
          currentEvent.substitutes.push({
            userId,
            nickname,
            steamId,
            squadLeader,
            squadHours,
            techSquad,
            numberPlayers,
          });
        } else {
          const teamIndex = currentEvent.teams.findIndex(
            (team) => team.name === selectedTeam
          );
          if (teamIndex === -1) {
            await interaction.reply({
              content: "Выбранная команда не существует.",
              ephemeral: true,
            });
            return;
          }
          const alreadyRegistered = currentEvent.teams.some((team) =>
            team.members.some((member) => member.userId === userId)
          );
          if (alreadyRegistered) {
            await interaction.reply({
              content: "Вы уже зарегистрированы в команде.",
              ephemeral: true,
            });
            return;
          }
          currentEvent.teams[teamIndex].members.push({
            userId,
            nickname,
            steamId,
            squadLeader,
            squadHours,
            techSquad,
            numberPlayers,
          });
        }

        await eventsCollection.updateOne(
          { eventId: currentEvent.eventId },
          {
            $set: {
              teams: currentEvent.teams,
              substitutes: currentEvent.substitutes,
            },
          }
        );
        const updatedEvent = await eventsCollection.findOne({
          eventId: currentEvent.eventId,
        });
        // Для соло-ивента всегда регистрируется 1 игрок
        await updateEventEmbed(client, updatedEvent, 1);
        await interaction.reply({
          content: `Вы успешно зарегистрированы в ${
            selectedTeam === "substitutes"
              ? "списке запасных"
              : `команде ${selectedTeam}`
          }.`,
          ephemeral: true,
        });
      }

      return;
    }
  } catch (error) {
    console.error("Ошибка при обработке взаимодействия:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "Произошла ошибка при обработке вашего запроса.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "Произошла ошибка при обработке вашего запроса.",
        ephemeral: true,
      });
    }
  }
});

await client.login(process.env.CLIENT_TOKEN);
