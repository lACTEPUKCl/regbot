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
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import getCommands from "./commands/getCommands.js";
import { MongoClient } from "mongodb";
import schedule from "node-schedule";
import { config } from "dotenv";
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

const timers = new Map(); // Локальный кэш таймеров для работы в оперативной памяти

// Функция для восстановления активных таймеров из базы
const restoreTimers = async () => {
  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect();
    const db = mongoClient.db("SquadJS");
    const notifications = db.collection("notifications");
    const events = db.collection("events");

    const activeNotifications = await notifications
      .find({
        status: "pending",
        endTime: { $gt: new Date() },
      })
      .toArray();

    for (const notification of activeNotifications) {
      const { userId, teamName, eventId, endTime } = notification;
      const remainingTime = new Date(endTime).getTime() - Date.now();

      if (remainingTime > 0) {
        schedule.scheduleJob(endTime, async () => {
          try {
            const event = await events.findOne({ eventId });
            if (!event) return;

            const team = event.teams.find((t) => t.name === teamName);
            if (!team) return;

            team.members = team.members.filter((m) => m.userId !== userId);

            // Удаляем уведомление
            await notifications.deleteOne({ _id: notification._id });

            console.log(
              `Игрок ${userId} удален из команды ${teamName} после истечения времени.`
            );

            await notifications.updateOne(
              { _id: notification._id },
              { $set: { status: "expired" } }
            );
          } catch (error) {
            console.error(`Ошибка при удалении игрока ${userId}:`, error);
          }
        });
      }
    }

    console.log(
      `Восстановлено ${activeNotifications.length} активных таймеров.`
    );
    await mongoClient.close();
  } catch (error) {
    console.error("Ошибка при восстановлении таймеров:", error);
  }
};

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
    const mongoClient = new MongoClient(process.env.MONGO_URI);

    try {
      await mongoClient.connect();
      const db = mongoClient.db("SquadJS");
      const events = db.collection("events");

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

      if (existingTeam) {
        await interaction.reply({
          content: `Вы уже зарегистрированы в команде: ${existingTeam.name}.`,
          ephemeral: true,
        });
        return;
      }

      // Проверяем, есть ли поле substitutes (скамейка запасных), если нет — создаем его
      if (!currentEvent.substitutes) {
        currentEvent.substitutes = [];
      }

      const isSubstitute = currentEvent.substitutes.some(
        (sub) => sub.userId === interaction.user.id
      );

      if (isSubstitute) {
        await interaction.reply({
          content: "Вы уже находитесь в списке запасных.",
          ephemeral: true,
        });
        return;
      }

      // Фильтруем команды, где количество участников меньше maxPlayersPerTeam
      const maxPlayersPerTeam = currentEvent.maxPlayersPerTeam || Infinity;
      const availableTeams = currentEvent.teams.filter(
        (team) => team.members.length < maxPlayersPerTeam
      );

      if (availableTeams.length === 0) {
        // Добавляем пользователя в скамейку запасных
        currentEvent.substitutes.push({
          userId: interaction.user.id,
          username: interaction.user.username,
        });

        await events.updateOne(
          { eventId: currentEvent.eventId },
          { $set: { substitutes: currentEvent.substitutes } }
        );

        await interaction.reply({
          content:
            "Все команды уже заполнены. Вы добавлены в список запасных участников.",
          ephemeral: true,
        });
        return;
      }

      // Формируем меню выбора только с доступными командами
      const teamOptions = availableTeams.map((team) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(team.name)
          .setValue(team.name)
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
    } finally {
      await mongoClient.close();
    }
  }

  if (interaction.isButton()) {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    const [action, userId, teamName] = interaction.customId.split("_");
    try {
      const db = mongoClient.db("SquadJS");
      const events = db.collection("events");
      const notifications = db.collection("notifications");

      if (action === "confirmDM") {
        // Подтверждение регистрации
        if (timers.has(userId)) {
          clearTimeout(timers.get(userId));
          timers.delete(userId);
        }

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
          if (timers.has(userId)) {
            clearTimeout(timers.get(userId)); // Завершаем таймер
            timers.delete(userId); // Удаляем из карты
          }

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

            // Обновляем Embed с регистрацией
            const eventChannel = await interaction.client.channels.fetch(
              event.channelId
            );
            const eventMessage = await eventChannel.messages.fetch(
              event.eventId
            );

            const maxPlayersPerTeam = event.maxPlayersPerTeam || "∞";

            const updatedEmbed = EmbedBuilder.from(
              eventMessage.embeds[0]
            ).setFields(
              event.teams.map((team) => ({
                name: `${team.name} (${team.members.length}/${maxPlayersPerTeam})`,
                value:
                  team.members
                    .map((member) => `${member.nickname} (${member.steamId})`)
                    .join("\n") || "-",
                inline: true,
              }))
            );

            await eventMessage.edit({ embeds: [updatedEmbed] });

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
    const mongoClient = new MongoClient(process.env.MONGO_URI);

    try {
      await mongoClient.connect();
      const db = mongoClient.db("SquadJS");
      const events = db.collection("events");

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

      if (!removed) {
        await interaction.reply({
          content: "Вы не зарегистрированы ни в одной команде.",
          ephemeral: true,
        });
        return;
      }

      // Обновляем данные в базе данных
      await events.updateOne(
        { eventId: event.eventId },
        { $set: { teams: event.teams } }
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

      // Получаем максимальное количество игроков на команду
      const maxPlayersPerTeam = event.maxPlayersPerTeam || "∞";

      // Формируем обновленные поля для embed
      const updatedFields = event.teams.map((team) => ({
        name: `${team.name} (${team.members.length}/${maxPlayersPerTeam})`,
        value:
          team.members
            .map((member) => `${member.nickname} (${member.steamId})`)
            .join("\n") || "-",
        inline: true,
      }));

      // Обновляем embed
      const existingEmbed = eventMessage.embeds?.[0];
      const updatedEmbed = existingEmbed
        ? EmbedBuilder.from(existingEmbed)
        : new EmbedBuilder()
            .setTitle("Регистрация на турнир")
            .setColor("#3498DB");

      updatedEmbed.setFields(updatedFields);

      await eventMessage.edit({
        embeds: [updatedEmbed],
      });

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
    } finally {
      await mongoClient.close();
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
    const steamId = interaction.fields.getTextInputValue("steamid_input");
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

    // Получение информации о никнейме из Steam API
    const steamApiKey = process.env.STEAM_API_KEY;
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

    currentEvent.teams[teamIndex].members.push({
      userId,
      nickname,
      steamId,
      squadLeader,
      squadHours,
    });

    const mongoClient = new MongoClient(process.env.MONGO_URI);

    try {
      await mongoClient.connect();
      const db = mongoClient.db("SquadJS");
      const events = db.collection("events");

      await events.updateOne(
        { eventId: currentEvent.eventId },
        { $set: { teams: currentEvent.teams } }
      );

      const eventChannel = await client.channels.fetch(currentEvent.channelId);
      if (!eventChannel) {
        await interaction.reply({
          content: "Ошибка: канал события не найден.",
          ephemeral: true,
        });
        return;
      }

      const eventMessage = await eventChannel.messages.fetch(
        currentEvent.eventId
      );
      if (!eventMessage) {
        await interaction.reply({
          content: "Ошибка: сообщение события не найдено.",
          ephemeral: true,
        });
        return;
      }

      // Обновляем Embed
      const existingEmbed = eventMessage.embeds?.[0];
      const updatedEmbed = existingEmbed
        ? EmbedBuilder.from(existingEmbed)
        : new EmbedBuilder()
            .setTitle("Регистрация на турнир")
            .setColor("#3498DB");

      const maxPlayersPerTeam = currentEvent.maxPlayersPerTeam || "∞";

      const updatedFields = currentEvent.teams.map((team) => ({
        name: `${team.name} (${team.members.length}/${maxPlayersPerTeam})`,
        value:
          team.members
            .map((member) => `${member.nickname} (${member.steamId})`)
            .join("\n") || "-",
        inline: true,
      }));

      updatedEmbed.setFields(updatedFields);

      await eventMessage.edit({
        embeds: [updatedEmbed],
      });

      await interaction.reply({
        content: `Вы успешно зарегистрированы в команде ${selectedTeam}.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Произошла ошибка при регистрации.",
        ephemeral: true,
      });
    } finally {
      await mongoClient.close();
    }
  }
});

await client.login(process.env.CLIENT_TOKEN);
