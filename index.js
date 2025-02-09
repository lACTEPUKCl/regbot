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
      // Обработка кнопки регистрации (customId === "register")
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
        const availableTeams = currentEvent.teams.filter(
          (team) => team.members.length < maxPlayersPerTeam
        );
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
          // Передаём eventId в customId, чтобы в дальнейшем знать, к какому событию относится выбор
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
      // Обработка кнопок подтверждения/отмены в DM (customId: confirmDM_userId_teamName или cancelDM_userId_teamName)
      else if (
        interaction.customId.startsWith("confirmDM_") ||
        interaction.customId.startsWith("cancelDM_")
      ) {
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
        // Если в названии команды могут быть символы "_" — объединяем оставшиеся части
        const teamName = parts.slice(2).join("_");

        const eventsCollection = await getCollection("events");
        const notificationsCollection = await getCollection("notifications");

        // Пытаемся найти уведомление для данного пользователя, команды и события
        const notification = await notificationsCollection.findOne({
          userId,
          teamName,
          status: "pending",
        });

        // Если уведомление найдено и содержит данные о канале и сообщении, удаляем сообщение из DM
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
          // Для подтверждения можно просто удалить уведомление и обновить эмбед, если уведомление содержит eventId
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
          // Удаляем уведомление из базы данных
          const deleteResult = await notificationsCollection.deleteOne({
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
          // Находим событие, в котором есть команда с указанным именем
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
          // Удаляем пользователя из участников нужной команды
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
          // Обновляем событие в базе данных
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
          // Удаляем уведомление из базы
          const delNotifResult = await notificationsCollection.deleteOne({
            userId,
            teamName,
            eventId: event.eventId,
            status: "pending",
          });
          console.log(
            "Уведомление после отмены удалено, результат:",
            delNotifResult
          );
          // Получаем обновлённое событие и обновляем эмбед
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

      // Обработка кнопки отмены регистрации (customId === "cancel")
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
        // Удаление из команд
        event.teams.forEach((team) => {
          const index = team.members.findIndex(
            (member) => member.userId === userId
          );
          if (index !== -1) {
            team.members.splice(index, 1);
            removed = true;
          }
        });
        // Удаление из списка запасных
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

      // Создание модального окна с передачей выбранной команды и eventId
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

      modal.addComponents(
        new ActionRowBuilder().addComponents(steamIdInput),
        new ActionRowBuilder().addComponents(clanTagInput),
        new ActionRowBuilder().addComponents(discordInviteInput)
      );

      await interaction.showModal(modal);
      return;
    } else if (
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

      const steamIdRaw = interaction.fields.getTextInputValue("steamid_input");
      const clanTag = interaction.fields.getTextInputValue("clan_tag_input");
      const discordLink = interaction.fields.getTextInputValue(
        "discord_invite_input"
      );

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
      // Получаем steamId64 через функцию getSteamId64
      const steamId = await getSteamId64(steamApiKey, steamIdRaw);

      // Если функция вернула пустое значение или null — Steam ID введён неверно
      if (!steamId) {
        await interaction.reply({
          content:
            "Неверный Steam ID. Пожалуйста, проверьте введённые данные и попробуйте снова.",
          ephemeral: true,
        });
        return;
      }

      const steamApiUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${steamApiKey}&steamids=${steamId}`;
      let nickname;
      try {
        const response = await fetch(steamApiUrl);
        const data = await response.json();
        if (
          data.response &&
          data.response.players &&
          data.response.players.length
        ) {
          nickname = data.response.players[0].personaname;
        } else {
          nickname = "Неизвестный игрок";
        }
      } catch (error) {
        console.error("Ошибка при запросе к Steam API:", error);
        nickname = "Неизвестный игрок";
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
          clanTag,
          discordLink,
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
        content: `Вы успешно зарегистрированы в ${
          selectedTeam === "substitutes"
            ? "списке запасных"
            : `команде ${selectedTeam}`
        }.`,
        ephemeral: true,
      });
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
