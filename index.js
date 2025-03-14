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

// Функция для определения языка из locale интеракции
function getLanguage(interaction) {
  return interaction.locale && interaction.locale.toLowerCase().startsWith("ru")
    ? "ru"
    : "en";
}

// Объект с локализованными сообщениями
const messages = {
  errorExecuting: {
    ru: "Произошла ошибка при выполнении команды.",
    en: "There was an error while executing the command.",
  },
  eventNotExist: {
    ru: "Это событие больше не существует.",
    en: "This event no longer exists.",
  },
  alreadyRegistered: {
    ru: "Вы уже зарегистрированы в команде.",
    en: "You are already registered in a team.",
  },
  alreadySubstitute: {
    ru: "Вы уже находитесь в списке запасных.",
    en: "You are already in the substitutes list.",
  },
  selectTeam: {
    ru: "Выберите команду для регистрации:",
    en: "Choose a team for registration:",
  },
  incorrectCommandFormat: {
    ru: "Неверный формат команды.",
    en: "Incorrect command format.",
  },
  confirmedParticipation: {
    ru: (teamName) => `Вы подтвердили участие в команде ${teamName}.`,
    en: (teamName) =>
      `You have confirmed your participation in team ${teamName}.`,
  },
  eventNotFoundForTeam: {
    ru: (teamName) => `Событие для команды ${teamName} не найдено.`,
    en: (teamName) => `Event for team ${teamName} not found.`,
  },
  cancelledParticipation: {
    ru: (teamName) => `Вы отменили участие в команде ${teamName}.`,
    en: (teamName) =>
      `You have cancelled your participation in team ${teamName}.`,
  },
  notRegistered: {
    ru: "Вы не зарегистрированы ни в одной команде и не находитесь в списке запасных.",
    en: "You are not registered in any team and are not in the substitutes list.",
  },
  registrationCancelled: {
    ru: "Ваша регистрация была успешно отменена.",
    en: "Your registration has been successfully cancelled.",
  },
  incorrectSelectFormat: {
    ru: "Неверный формат команды выбора.",
    en: "Incorrect selection format.",
  },
  eventNotFound: {
    ru: "Событие не найдено.",
    en: "Event not found.",
  },
  invalidModalFormat: {
    ru: "Неверный формат модального окна.",
    en: "Incorrect modal format.",
  },
  invalidSteamId: {
    ru: "Неверный Steam ID. Пожалуйста, проверьте введённые данные и попробуйте снова.",
    en: "Invalid Steam ID. Please check your input and try again.",
  },
  invalidNumberPlayers: {
    ru: "Пожалуйста, введите корректное количество игроков.",
    en: "Please enter a valid number of players.",
  },
  tooManyPlayers: {
    ru: (team, freeSlots) =>
      `В команде **${team}** осталось всего **${freeSlots}** свободных мест. Пожалуйста, укажите количество игроков не более этого значения.`,
    en: (team, freeSlots) =>
      `There are only **${freeSlots}** slots left in team **${team}**. Please specify a number of players not exceeding this value.`,
  },
  registrationSuccess: {
    ru: (teamName) =>
      `Вы успешно зарегистрированы в ${
        teamName === "substitutes" ? "списке запасных" : `команде ${teamName}`
      }.`,
    en: (teamName) =>
      `You have successfully registered in ${
        teamName === "substitutes" ? "the substitutes list" : `team ${teamName}`
      }.`,
  },
  invalidHours: {
    ru: "Пожалуйста, введите корректное количество часов.",
    en: "Please enter a valid number of hours.",
  },
};

client.on(Events.InteractionCreate, async (interaction) => {
  // Определяем язык для данной интеракции
  const language = getLanguage(interaction);

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
            content: messages.errorExecuting[language],
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: messages.errorExecuting[language],
            ephemeral: true,
          });
        }
      }
      return;
    }

    // Обработка кнопок
    else if (interaction.isButton()) {
      // Кнопка регистрации (customId начинается с "register_")
      if (interaction.customId.startsWith("register_")) {
        const eventsCollection = await getCollection("events");
        const eventId = interaction.message.id;
        const currentEvent = await eventsCollection.findOne({ eventId });

        if (!currentEvent) {
          await interaction.reply({
            content: messages.eventNotExist[language],
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
              ? messages.alreadyRegistered[language]
              : messages.alreadySubstitute[language],
            ephemeral: true,
          });
          return;
        }

        // Формирование списка доступных команд
        const maxPlayersPerTeam = currentEvent.maxPlayersPerTeam || Infinity;
        const availableTeams = currentEvent.teams.filter((team) => {
          const currentPlayers = team.members.reduce(
            (acc, member) => acc + (member.numberPlayers || 1),
            0
          );
          const freeSlots = maxPlayersPerTeam - currentPlayers;
          return freeSlots > 0;
        });

        const teamOptions = availableTeams.map((team) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(team.name)
            .setValue(team.name)
        );
        // Добавляем опцию для запасных
        teamOptions.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(language === "ru" ? "Скамья запасных" : "Substitutes")
            .setValue("substitutes")
        );

        const teamSelectMenu = new StringSelectMenuBuilder()
          .setCustomId(`team_select_menu_${eventId}`)
          .setPlaceholder(
            language === "ru" ? "Выберите команду" : "Select a team"
          )
          .addOptions(teamOptions);

        const actionRow = new ActionRowBuilder().addComponents(teamSelectMenu);

        await interaction.reply({
          content: messages.selectTeam[language],
          components: [actionRow],
          ephemeral: true,
        });
        return;
      }
      // Кнопки подтверждения/отмены в DM (customId начинается с "confirmDM_" или "cancelDM_")
      else if (
        interaction.customId.startsWith("confirmDM_") ||
        interaction.customId.startsWith("cancelDM_")
      ) {
        const parts = interaction.customId.split("_");
        if (parts.length < 3) {
          await interaction.reply({
            content: messages.incorrectCommandFormat[language],
            ephemeral: true,
          });
          return;
        }
        const action = parts[0];
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
            content: messages.confirmedParticipation[language](teamName),
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
              content: messages.eventNotFoundForTeam[language](teamName),
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
              content: messages.alreadyRegistered[language],
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
              content: messages.errorExecuting[language],
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
            content: messages.cancelledParticipation[language](teamName),
            ephemeral: true,
          });
        }
        return;
      }
      // Кнопка отмены регистрации (customId начинается с "cancel_")
      else if (interaction.customId.startsWith("cancel_")) {
        const eventsCollection = await getCollection("events");
        const eventId = interaction.message.id;
        const event = await eventsCollection.findOne({ eventId });
        if (!event) {
          await interaction.reply({
            content: messages.eventNotExist[language],
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
            content: messages.notRegistered[language],
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
          content: messages.registrationCancelled[language],
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
      const customIdParts = interaction.customId.split("_");
      if (customIdParts.length < 4) {
        await interaction.reply({
          content: messages.incorrectSelectFormat[language],
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
          content: messages.eventNotFound[language],
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
          content: messages.alreadyRegistered[language],
          ephemeral: true,
        });
        return;
      }

      // В зависимости от типа ивента показываем разные модальные окна
      if (currentEvent.eventType === "clan") {
        const modal = new ModalBuilder()
          .setCustomId(`register_modal_${selectedTeam}_${eventId}`)
          .setTitle(
            language === "ru"
              ? "Регистрация на турнир"
              : "Tournament Registration"
          );
        const steamIdInput = new TextInputBuilder()
          .setCustomId("steamid_input")
          .setLabel(
            language === "ru"
              ? "Введите ссылку на профиль Steam или SteamID64"
              : "Enter your Steam profile link or SteamID64"
          )
          .setPlaceholder(
            language === "ru"
              ? "Пример: https://steamcommunity.com/id/yourprofile"
              : "Example: https://steamcommunity.com/id/yourprofile"
          )
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const clanTagInput = new TextInputBuilder()
          .setCustomId("clan_tag_input")
          .setLabel(
            language === "ru"
              ? "Введите клан тег (без скобок)"
              : "Enter clan tag (without brackets)"
          )
          .setPlaceholder(
            language === "ru" ? "Пример: ABC или XYZ" : "Example: ABC or XYZ"
          )
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const discordInviteInput = new TextInputBuilder()
          .setCustomId("discord_invite_input")
          .setLabel(
            language === "ru"
              ? "Введите ссылку на Discord сообщество"
              : "Enter your Discord invite link"
          )
          .setPlaceholder(
            language === "ru"
              ? "Пример: https://discord.gg/yourclan"
              : "Example: https://discord.gg/yourclan"
          )
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const numberPlayersInput = new TextInputBuilder()
          .setCustomId("number_players_input")
          .setLabel(
            language === "ru"
              ? "Введите количество игроков"
              : "Enter the number of players"
          )
          .setPlaceholder(language === "ru" ? "Пример: 5" : "Example: 5")
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
          .setTitle(
            language === "ru"
              ? "Регистрация на турнир (Solo)"
              : "Tournament Registration (Solo)"
          );
        const steamIdInput = new TextInputBuilder()
          .setCustomId("steamid_input")
          .setLabel(
            language === "ru" ? "Введите ваш Steam ID" : "Enter your Steam ID"
          )
          .setPlaceholder(language === "ru" ? "Ваш Steam ID" : "Your Steam ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const squadLeaderInput = new TextInputBuilder()
          .setCustomId("squad_leader_input")
          .setLabel(
            language === "ru"
              ? "Хотите ли вы быть сквадным?"
              : "Do you want to be a squad leader?"
          )
          .setPlaceholder(language === "ru" ? "Да/Нет" : "Yes/No")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const squadHoursInput = new TextInputBuilder()
          .setCustomId("squad_hours_input")
          .setLabel(
            language === "ru"
              ? "Сколько часов вы провели в Squad?"
              : "How many hours have you played in Squad?"
          )
          .setPlaceholder(
            language === "ru"
              ? "Введите количество часов"
              : "Enter number of hours"
          )
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const techSquadInput = new TextInputBuilder()
          .setCustomId("tech_squad_input")
          .setLabel(
            language === "ru"
              ? "Хотите ли вы быть в отряде 'Тех'?"
              : "Do you want to join the 'Tech' squad?"
          )
          .setPlaceholder(language === "ru" ? "Да/Нет" : "Yes/No")
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
          content: messages.invalidModalFormat[language],
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
          content:
            language === "ru"
              ? "Событие не найдено. Попробуйте снова."
              : "Event not found. Please try again.",
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
          content: messages.invalidSteamId[language],
          ephemeral: true,
        });
        return;
      }

      // Получение данных с Steam API
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
          nickname = language === "ru" ? "Неизвестный игрок" : "Unknown player";
        }
      } catch (error) {
        console.error("Ошибка при запросе к Steam API:", error);
        nickname = language === "ru" ? "Неизвестный игрок" : "Unknown player";
      }

      // Регистрация для clan-ивента
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
            content: messages.invalidNumberPlayers[language],
            ephemeral: true,
          });
          return;
        }

        if (numberPlayers > currentEvent.maxPlayersPerTeam) {
          const currentPlayers = currentEvent.teams
            .find((team) => team.name === selectedTeam)
            ?.members.reduce(
              (acc, member) => acc + (member.numberPlayers || 1),
              0
            );
          const freeSlots =
            (currentEvent.maxPlayersPerTeam || Infinity) -
            (currentPlayers || 0);
          await interaction.reply({
            content: messages.tooManyPlayers[language](selectedTeam, freeSlots),
            ephemeral: true,
          });
          return;
        }

        if (selectedTeam === "substitutes") {
          if (!currentEvent.substitutes) {
            currentEvent.substitutes = [];
          }
          const alreadySubstitute = currentEvent.substitutes.some(
            (sub) => sub.userId === userId
          );
          if (alreadySubstitute) {
            await interaction.reply({
              content: messages.alreadySubstitute[language],
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
          const teamIndex = currentEvent.teams.findIndex(
            (team) => team.name === selectedTeam
          );
          if (teamIndex === -1) {
            await interaction.reply({
              content:
                language === "ru"
                  ? "Выбранная команда не существует."
                  : "Selected team does not exist.",
              ephemeral: true,
            });
            return;
          }

          const alreadyRegistered = currentEvent.teams.some((team) =>
            team.members.some((member) => member.userId === userId)
          );
          if (alreadyRegistered) {
            await interaction.reply({
              content: messages.alreadyRegistered[language],
              ephemeral: true,
            });
            return;
          }

          const currentPlayers = currentEvent.teams[teamIndex].members.reduce(
            (acc, member) => acc + (member.numberPlayers || 1),
            0
          );
          const maxPlayersPerTeam = currentEvent.maxPlayersPerTeam || Infinity;

          if (currentPlayers + numberPlayers > maxPlayersPerTeam) {
            const freeSlots = maxPlayersPerTeam - currentPlayers;
            await interaction.reply({
              content: messages.tooManyPlayers[language](
                selectedTeam,
                freeSlots
              ),
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
          content: messages.registrationSuccess[language](selectedTeam),
          ephemeral: true,
        });
      }
      // Регистрация для solo-ивента
      else if (currentEvent.eventType === "solo") {
        const squadLeader =
          interaction.fields.getTextInputValue("squad_leader_input");
        const squadHoursRaw =
          interaction.fields.getTextInputValue("squad_hours_input");
        const techSquad =
          interaction.fields.getTextInputValue("tech_squad_input");

        let squadHours;
        if (game && game.playtime_forever) {
          squadHours = `**${(game.playtime_forever / 60).toFixed(0)}**`;
        } else {
          squadHours = squadHoursRaw;
        }

        const squadHoursNumeric = parseInt(squadHours.replace(/\*\*/g, ""), 10);

        if (isNaN(squadHoursNumeric) || squadHoursNumeric < 0) {
          await interaction.reply({
            content: messages.invalidHours[language],
            ephemeral: true,
          });
          return;
        }

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
              content: messages.alreadySubstitute[language],
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
              content:
                language === "ru"
                  ? "Выбранная команда не существует."
                  : "Selected team does not exist.",
              ephemeral: true,
            });
            return;
          }
          const alreadyRegistered = currentEvent.teams.some((team) =>
            team.members.some((member) => member.userId === userId)
          );
          if (alreadyRegistered) {
            await interaction.reply({
              content: messages.alreadyRegistered[language],
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
        await updateEventEmbed(client, updatedEvent, 1);
        await interaction.reply({
          content: messages.registrationSuccess[language](selectedTeam),
          ephemeral: true,
        });
      }
      return;
    }
  } catch (error) {
    console.error("Ошибка при обработке взаимодействия:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content:
          language === "ru"
            ? "Произошла ошибка при обработке вашего запроса."
            : "An error occurred while processing your request.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content:
          language === "ru"
            ? "Произошла ошибка при обработке вашего запроса."
            : "An error occurred while processing your request.",
        ephemeral: true,
      });
    }
  }
});

await client.login(process.env.CLIENT_TOKEN);
