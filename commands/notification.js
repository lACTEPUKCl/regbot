import schedule from "node-schedule";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";
import { MongoClient } from "mongodb";

const notification = new SlashCommandBuilder()
  .setName("notification")
  .setDescription("Запланировать уведомление для игроков")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("teams")
      .setDescription("Названия команд через запятую")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("send_time")
      .setDescription("Дата и время отправки (в формате ГГГГ-ММ-ДД ЧЧ:ММ)")
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
  const sendTimeInput = interaction.options.getString("send_time"); // ГГГГ-ММ-ДД ЧЧ:ММ
  const responseTime = interaction.options.getInteger("response_time");

  const mongoClient = new MongoClient(process.env.MONGO_URI);

  try {
    await mongoClient.connect();
    const db = mongoClient.db("SquadJS");
    const events = db.collection("events");
    const notifications = db.collection("notifications");

    const teamNames = teamsInput.split(",").map((name) => name.trim());

    // Преобразуем строку времени в объект Date
    const sendTime = new Date(sendTimeInput.replace(" ", "T") + ":00.000Z");
    // Учитываем смещение для перевода из MSK (UTC+3) в UTC
    sendTime.setHours(sendTime.getHours() - 3);

    if (isNaN(sendTime.getTime())) {
      await interaction.reply({
        content: "Неверный формат даты. Используйте ГГГГ-ММ-ДД ЧЧ:ММ",
        ephemeral: true,
      });
      return;
    }

    const affectedEvents = await events
      .find({ "teams.name": { $in: teamNames } })
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
          if (!user) continue;

          // Время окончания ответа (дедлайн)
          const endTime = new Date(
            sendTime.getTime() + responseTime * 60 * 60 * 1000
          );

          // Сохраняем уведомление в базе
          await notifications.insertOne({
            userId: member.userId,
            teamName: team.name,
            eventId: event.eventId,
            sendTime,
            endTime,
            status: "pending",
          });

          // Планируем отправку уведомления в указанное время
          schedule.scheduleJob(sendTime, async () => {
            try {
              const notification = await notifications.findOne({
                userId: member.userId,
                teamName: team.name,
                eventId: event.eventId,
                status: "pending",
              });

              if (!notification) return;

              const dmChannel = await user.createDM();
              const embed = new EmbedBuilder()
                .setTitle("Подтверждение участия")
                .setDescription(
                  `Вы зарегистрированы в команде **${team.name}**. Подтвердите участие, нажав "Подтвердить" или "Отменить". У вас есть ${responseTime} часов.`
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

              await dmChannel.send({ embeds: [embed], components: [row] });

              await notifications.updateOne(
                { _id: notification._id },
                { $set: { status: "sent" } }
              );

              console.log(
                `Уведомление отправлено игроку ${member.userId} в ${team.name}`
              );
            } catch (error) {
              console.error(
                `Ошибка при отправке уведомления ${member.userId}:`,
                error
              );
            }
          });

          // Планируем удаление игрока, если он не ответит
          schedule.scheduleJob(endTime, async () => {
            try {
              const notification = await notifications.findOne({
                userId: member.userId,
                teamName: team.name,
                eventId: event.eventId,
                status: "sent",
              });

              if (!notification) return;

              // Удаляем игрока из команды
              team.members = team.members.filter(
                (m) => m.userId !== member.userId
              );

              await events.updateOne(
                { eventId: event.eventId },
                { $set: { teams: event.teams } }
              );

              console.log(
                `Игрок ${member.userId} удален из команды ${team.name} за неответ.`
              );

              // Удаляем уведомление
              await notifications.deleteOne({ _id: notification._id });
            } catch (error) {
              console.error(
                `Ошибка при удалении игрока ${member.userId}:`,
                error
              );
            }
          });
        }
      }
    }

    await interaction.reply({
      content: `Уведомления запланированы на ${sendTime.toLocaleString(
        "ru-RU",
        { timeZone: "Europe/Moscow" }
      )} и истекают через ${responseTime} час(ов).`,
      ephemeral: true,
    });
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "Произошла ошибка при планировании уведомлений.",
      ephemeral: true,
    });
  }
};

export default { data: notification, execute };
