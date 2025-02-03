import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { MongoClient } from "mongodb";

const notification = new SlashCommandBuilder()
  .setName("notification")
  .setDescription("Уведомить игроков из указанных команд")
  .addStringOption((option) =>
    option
      .setName("teams")
      .setDescription("Названия команд через запятую")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("response_time")
      .setDescription("Время в часах для ответа от игроков")
      .setRequired(true)
  );

const execute = async (interaction) => {
  const teamsInput = interaction.options.getString("teams");
  const responseTime = interaction.options.getInteger("response_time");

  const mongoClient = new MongoClient(process.env.MONGO_URI);
  const timers = new Map(); // Карта для хранения активных таймеров

  try {
    await mongoClient.connect();
    const db = mongoClient.db("SquadJS");
    const events = db.collection("events");
    const notifications = db.collection("notifications");

    const teamNames = teamsInput.split(",").map((name) => name.trim());

    // Находим события с указанными командами
    const affectedEvents = await events
      .find({
        "teams.name": { $in: teamNames },
      })
      .toArray();

    if (affectedEvents.length === 0) {
      await interaction.reply({
        content: "Команды не найдены в зарегистрированных событиях.",
        ephemeral: true,
      });
      return;
    }

    for (const event of affectedEvents) {
      for (const team of event.teams) {
        if (!teamNames.includes(team.name)) continue;

        for (const member of team.members) {
          const user = await interaction.client.users.fetch(member.userId);
          if (!user) {
            console.warn(`Пользователь с ID ${member.userId} не найден.`);
            continue;
          }

          // Отправляем уведомление с кнопками
          const dmChannel = await user.createDM();
          const embed = new EmbedBuilder()
            .setTitle("Подтверждение участия")
            .setDescription(
              `Вы зарегистрированы в команде **${team.name}**. Пожалуйста, подтвердите участие, нажав "Подтвердить" или "Отменить". Если вы не ответите в течение ${responseTime} часов, ваша регистрация будет аннулирована.`
            )
            .setColor("#3498DB");

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`confirmDM_${member.userId}_${team.name}`)
              .setLabel("Подтвердить")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`cancelDM_${member.userId}_${team.name}`)
              .setLabel("Отменить")
              .setStyle(ButtonStyle.Danger)
          );

          await dmChannel.send({
            embeds: [embed],
            components: [row],
          });

          // Сохраняем уведомление в базе данных
          const timerEndTime = new Date(
            Date.now() + responseTime * 60 * 60 * 1000
          );
          await notifications.insertOne({
            userId: member.userId,
            teamName: team.name,
            eventId: event.eventId,
            endTime: timerEndTime,
            status: "pending",
          });

          // Устанавливаем таймер для удаления пользователя
          const timerId = setTimeout(async () => {
            // Проверяем статус перед удалением
            const notification = await notifications.findOne({
              userId: member.userId,
              teamName: team.name,
              eventId: event.eventId,
            });

            if (notification && notification.status === "pending") {
              // Удаляем игрока из команды
              team.members = team.members.filter(
                (m) => m.userId !== member.userId
              );

              // Обновляем данные в базе
              await events.updateOne(
                { eventId: event.eventId },
                { $set: { teams: event.teams } }
              );

              console.log(
                `Игрок ${member.userId} был удалён из команды ${team.name} за неответ.`
              );

              // Обновляем статус уведомления
              await notifications.deleteOne({
                userId: member.userId,
                teamName: team.name,
                eventId: event.eventId,
                status: "pending",
              });

              // Обновляем Embed сообщения
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
            }

            // Удаляем таймер из карты
            timers.delete(member.userId);
          }, responseTime * 60 * 60 * 1000);

          timers.set(member.userId, timerId);
        }
      }
    }

    await interaction.reply({
      content: `Уведомления отправлены игрокам из указанных команд. Таймер установлен на ${responseTime} час(ов).`,
      ephemeral: true,
    });
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "Произошла ошибка при отправке уведомлений.",
      ephemeral: true,
    });
  } finally {
    await mongoClient.close();
  }
};

export default { data: notification, execute };
