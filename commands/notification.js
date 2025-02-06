import schedule from "node-schedule";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";
import { DateTime } from "luxon";
import { getCollection } from "../utils/mongodb.js";
import { updateEventEmbed } from "../utils/updateEventEmbed.js";

const notification = new SlashCommandBuilder()
  .setName("notification")
  .setDescription("Запланировать уведомление для игроков")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("event_id")
      .setDescription("ID события, для которого отправляются уведомления")
      .setRequired(true)
  )
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
  const sendTimeInput = interaction.options.getString("send_time");
  const responseTime = interaction.options.getInteger("response_time");

  try {
    const events = await getCollection("events");
    const notifications = await getCollection("notifications");

    const teamNames = teamsInput.split(",").map((name) => name.trim());

    // Парсим время, введённое пользователем, как московское
    let sendTime = DateTime.fromFormat(sendTimeInput, "yyyy-MM-dd HH:mm", {
      zone: "Europe/Moscow",
    }).toJSDate();

    if (isNaN(sendTime.getTime())) {
      await interaction.reply({
        content: "Неверный формат даты. Используйте ГГГГ-ММ-ДД ЧЧ:ММ",
        ephemeral: true,
      });
      return;
    }

    const eventId = interaction.options.getString("event_id");

    const affectedEvents = await events
      .find({ eventId, "teams.name": { $in: teamNames } })
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

          const endTime = new Date(
            sendTime.getTime() + responseTime * 60 * 60 * 1000
          );

          const notificationRecord = await notifications.insertOne({
            userId: member.userId,
            teamName: team.name,
            eventId: event.eventId,
            sendTime,
            endTime,
            status: "pending",
          });

          schedule.scheduleJob(sendTime, async () => {
            try {
              const dmChannel = await user.createDM();
              const embed = new EmbedBuilder()
                .setTitle("Подтверждение участия")
                .setDescription(
                  `Вы зарегистрированы в команде **${team.name}**. Подтвердите участие, нажав \"Подтвердить\" или \"Отменить\". У вас есть ${responseTime} ч.`
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

              const message = await dmChannel.send({
                embeds: [embed],
                components: [row],
              });

              await notifications.updateOne(
                { _id: notificationRecord.insertedId },
                { $set: { messageId: message.id, channelId: dmChannel.id } }
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

          schedule.scheduleJob(endTime, async () => {
            try {
              const notification = await notifications.findOne({
                userId: member.userId,
                teamName: team.name,
                eventId: event.eventId,
                status: "pending",
              });

              if (!notification) return;

              team.members = team.members.filter(
                (m) => m.userId !== member.userId
              );
              await events.updateOne(
                { eventId: event.eventId },
                { $set: { teams: event.teams } }
              );

              if (notification.channelId && notification.messageId) {
                const dmChannel = await interaction.client.channels.fetch(
                  notification.channelId
                );
                if (dmChannel) {
                  const message = await dmChannel.messages
                    .fetch(notification.messageId)
                    .catch(() => null);
                  if (message) await message.delete();
                }
              }

              await user
                .send(
                  `Вы были исключены из команды ${team.name} из-за отсутствия подтверждения готовности к участию в игре.`
                )
                .catch(() => null);

              await notifications.deleteOne({ _id: notification._id });

              await updateEventEmbed(interaction.client, event);
              console.log(
                `Игрок ${member.userId} удален из команды ${team.name} за неответ.`
              );
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
