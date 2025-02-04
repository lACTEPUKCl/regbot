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
client.commands = new Collection();
const commands = await getCommands();
let currentEvent = null;
for (const command of commands) {
  if ("data" in command && "execute" in command)
    client.commands.set(command.data.name, command);
  else console.log("The command is missing 'data' or 'execute' property.");
}

// Функция для восстановления активных таймеров из базы
// const restoreTimers = async () => {
//   try {
//     const notifications = await getCollection("notifications");
//     const events = await getCollection("events");

//     const activeNotifications = await notifications
//       .find({
//         status: "pending",
//         endTime: { $gt: new Date() },
//       })
//       .toArray();

//     for (const notification of activeNotifications) {
//       const { userId, teamName, eventId, endTime, messageId, channelId } =
//         notification;
//       const remainingTime = new Date(endTime).getTime() - Date.now();

//       if (remainingTime > 0) {
//         schedule.scheduleJob(endTime, async () => {
//           try {
//             const event = await events.findOne({ eventId });
//             if (!event) return;

//             const team = event.teams.find((t) => t.name === teamName);
//             if (!team) return;

//             team.members = team.members.filter((m) => m.userId !== userId);

//             // Удаляем уведомление из базы данных
//             await notifications.deleteOne({ _id: notification._id });

//             console.log(
//               `Игрок ${userId} удален из команды ${teamName} после истечения времени.`
//             );

//             // Отправка уведомления пользователю в DM
//             try {
//               const user = await client.users.fetch(userId);
//               if (user) {
//                 await user.send(
//                   `Вы были исключены из команды ${teamName} из-за отсутствия подтверждения готовности к участию в игре.`
//                 );
//               }
//             } catch (dmError) {
//               console.error(
//                 `Не удалось отправить уведомление пользователю ${userId}:`,
//                 dmError
//               );
//             }

//             // Удаление сообщения с уведомлением из DM
//             if (messageId && channelId) {
//               try {
//                 const dmChannel = await client.channels.fetch(channelId);
//                 if (dmChannel) {
//                   const message = await dmChannel.messages.fetch(messageId);
//                   if (message) {
//                     await message.delete();
//                     console.log(
//                       `Сообщение с ID ${messageId} удалено из DM-канала ${channelId}.`
//                     );
//                   }
//                 }
//               } catch (msgError) {
//                 console.error(
//                   `Ошибка при удалении DM сообщения ${messageId} из канала ${channelId}:`,
//                   msgError
//                 );
//               }
//             }
//           } catch (error) {
//             console.error(`Ошибка при удалении игрока ${userId}:`, error);
//           }
//         });
//       }
//     }

//     console.log(
//       `Восстановлено ${activeNotifications.length} активных таймеров.`
//     );
//   } catch (error) {
//     console.error("Ошибка при восстановлении таймеров:", error);
//   }
// };

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await restoreTimers();
});

client.on(Events.InteractionCreate, async (interaction) => {
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
  }

  if (interaction.isButton() && interaction.customId === "register") {
    try {
      const events = await getCollection("events");
      currentEvent = await events.findOne({ eventId: interaction.message.id });

      if (!currentEvent) {
        await interaction.reply({
          content: "Это событие больше не существует.",
          ephemeral: true,
        });
        return;
      }

      const existingTeam = currentEvent.teams.find((team) =>
        team.members.some((member) => member.userId === interaction.user.id)
      );

      const isSubstitute =
        currentEvent.substitutes &&
        currentEvent.substitutes.some(
          (sub) => sub.userId === interaction.user.id
        );

      if (existingTeam || isSubstitute) {
        await interaction.reply({
          content: existingTeam
            ? `Вы уже зарегистрированы в команде: ${existingTeam.name}.`
            : "Вы уже находитесь в списке запасных.",
          ephemeral: true,
        });
        return;
      }

      if (!currentEvent.substitutes) {
        currentEvent.substitutes = [];
      }

      const maxPlayersPerTeam = currentEvent.maxPlayersPerTeam || Infinity;
      const availableTeams = currentEvent.teams.filter(
        (team) => team.members.length < maxPlayersPerTeam
      );

      const teamOptions = availableTeams.map((team) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(team.name)
          .setValue(team.name)
      );

      teamOptions.push(
        new StringSelectMenuOptionBuilder()
          .setLabel("Скамья запасных")
          .setValue("substitutes")
      );

      const teamSelectMenu = new StringSelectMenuBuilder()
        .setCustomId("team_select_menu")
        .setPlaceholder("Выберите команду")
        .addOptions(teamOptions);

      const actionRow = new ActionRowBuilder().addComponents(teamSelectMenu);

      await interaction.reply({
        content: "Выберите команду для регистрации:",
        components: [actionRow],
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Произошла ошибка при обработке команды.",
        ephemeral: true,
      });
    }
  }

  if (interaction.isButton()) {
    const [action, userId, teamName] = interaction.customId.split("_");
    try {
      const events = await getCollection("events");
      const notifications = await getCollection("notifications");

      if (action === "confirmDM") {
        // Подтверждение регистрации
        await notifications.updateOne(
          { userId, teamName, status: "pending" },
          { $set: { status: "confirmed" } }
        );

        await interaction.reply({
          content: `Вы подтвердили участие в команде ${teamName}.`,
          ephemeral: true,
        });
        console.log(
          `Игрок ${userId} подтвердил участие в команде ${teamName}.`
        );
      } else if (action === "cancelDM") {
        try {
          const event = await events.findOne({ "teams.name": teamName });

          if (!event) {
            await interaction.reply({
              content: `Событие для команды ${teamName} не найдено.`,
              ephemeral: true,
            });
            return;
          }

          const team = event.teams.find((t) => t.name === teamName);

          if (team) {
            // Удаляем пользователя из команды
            team.members = team.members.filter((m) => m.userId !== userId);

            // Обновляем данные события в базе
            await events.updateOne(
              { eventId: event.eventId },
              { $set: { teams: event.teams } }
            );

            await updateEventEmbed(client, event);

            console.log(
              `Игрок ${userId} удалён из команды ${teamName} и данные обновлены.`
            );
          }

          await notifications.deleteOne({
            userId,
            teamName,
            eventId: event.eventId,
            status: "pending",
          });

          await interaction.reply({
            content: `Вы отменили участие в команде ${teamName}.`,
            ephemeral: true,
          });
        } catch (error) {
          console.error("Ошибка при обработке кнопки отмены:", error);
          await interaction.reply({
            content: "Произошла ошибка при отмене вашего участия.",
            ephemeral: true,
          });
        }
      }
    } catch (error) {
      console.error("Ошибка при обработке кнопки:", error);
      await interaction.reply({
        content: "Произошла ошибка при обработке вашего ответа.",
        ephemeral: true,
      });
    }
  }

  if (interaction.isButton() && interaction.customId === "cancel") {
    try {
      const events = await getCollection("events");

      const event = await events.findOne({ eventId: interaction.message.id });

      if (!event) {
        await interaction.reply({
          content: "Это событие больше не существует.",
          ephemeral: true,
        });
        return;
      }

      const userId = interaction.user.id;
      let removed = false;

      // Удаляем игрока из списка участников команды
      event.teams.forEach((team) => {
        const memberIndex = team.members.findIndex(
          (member) => member.userId === userId
        );

        if (memberIndex !== -1) {
          team.members.splice(memberIndex, 1); // Удаляем пользователя
          removed = true;
        }
      });

      // Удаляем игрока из списка запасных
      if (event.substitutes) {
        const substituteIndex = event.substitutes.findIndex(
          (sub) => sub.userId === userId
        );

        if (substituteIndex !== -1) {
          event.substitutes.splice(substituteIndex, 1);
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

      // Обновляем данные в базе данных
      await events.updateOne(
        { eventId: event.eventId },
        { $set: { teams: event.teams, substitutes: event.substitutes } }
      );

      // Обновляем сообщение с регистрацией
      const eventChannel = await client.channels.fetch(event.channelId);
      if (!eventChannel) {
        await interaction.reply({
          content: "Ошибка: канал события не найден.",
          ephemeral: true,
        });
        return;
      }

      const eventMessage = await eventChannel.messages.fetch(event.eventId);
      if (!eventMessage) {
        await interaction.reply({
          content: "Ошибка: сообщение события не найдено.",
          ephemeral: true,
        });
        return;
      }

      await updateEventEmbed(client, event);

      await interaction.reply({
        content: "Ваша регистрация была успешно отменена.",
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Произошла ошибка при отмене регистрации.",
        ephemeral: true,
      });
    }
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "team_select_menu"
  ) {
    const selectedTeam = interaction.values[0];

    const existingTeam = currentEvent.teams.find((team) =>
      team.members.some((member) => member.userId === interaction.user.id)
    );

    if (existingTeam) {
      await interaction.reply({
        content: `Вы уже зарегистрированы в команде: ${existingTeam.name}.`,
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`register_modal_${selectedTeam}`)
      .setTitle("Регистрация на турнир");

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

    modal.addComponents(
      new ActionRowBuilder().addComponents(squadLeaderInput),
      new ActionRowBuilder().addComponents(steamIdInput),
      new ActionRowBuilder().addComponents(squadHoursInput)
    );

    await interaction.showModal(modal);
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("register_modal_")
  ) {
    const selectedTeam = interaction.customId.replace("register_modal_", "");
    let steamId = interaction.fields.getTextInputValue("steamid_input");
    const squadLeader =
      interaction.fields.getTextInputValue("squad_leader_input");
    const squadHours =
      interaction.fields.getTextInputValue("squad_hours_input");

    if (!currentEvent) {
      await interaction.reply({
        content: "Событие не найдено. Попробуйте снова.",
        ephemeral: true,
      });
      return;
    }

    const userId = interaction.user.id;

    // Получение информации о никнейме из Steam API
    const steamApiKey = process.env.STEAM_API_KEY;
    steamId = await getSteamId64(steamApiKey, steamId);
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

      const isSubstitute = currentEvent.substitutes.some(
        (sub) => sub.userId === userId
      );

      if (isSubstitute) {
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

      const existingTeam = currentEvent.teams.find((team) =>
        team.members.some((member) => member.userId === userId)
      );

      if (existingTeam) {
        await interaction.reply({
          content: `Вы уже зарегистрированы в команде: ${existingTeam.name}.`,
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
      });
    }

    try {
      const events = await getCollection("events");
      await events.updateOne(
        { eventId: currentEvent.eventId },
        {
          $set: {
            teams: currentEvent.teams,
            substitutes: currentEvent.substitutes,
          },
        }
      );

      const event = await events.findOne({ eventId: currentEvent.eventId });
      console.log(currentEvent.eventId);

      await updateEventEmbed(client, event);
      await interaction.reply({
        content: `Вы успешно зарегистрированы в ${
          selectedTeam === "substitutes"
            ? "списке запасных"
            : `команде ${selectedTeam}`
        }.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Произошла ошибка при регистрации.",
        ephemeral: true,
      });
    }
  }
});

await client.login(process.env.CLIENT_TOKEN);
