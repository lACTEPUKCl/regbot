import schedule from "node-schedule";
import { getCollection } from "../utils/mongodb.js";
import { removePlayerFromTeam } from "../utils/removePlayer.js";
import { deleteNotification } from "../utils/deleteNotification.js";
import { updateEventEmbed } from "../utils/updateEventEmbed.js";

// Локализованные сообщения для DM уведомлений (по умолчанию английский)
const dmMessages = {
  dmRemoval: {
    ru: (teamName) =>
      `Вы были исключены из команды **${teamName}** из-за отсутствия подтверждения готовности к участию в игре.`,
    en: (teamName) =>
      `You have been removed from team **${teamName}** due to not confirming your readiness to participate.`,
  },
};

export const restoreTimers = async (client) => {
  try {
    const notifications = await getCollection("notifications");
    const activeNotifications = await notifications
      .find({
        status: "pending",
        endTime: { $gt: new Date() },
      })
      .toArray();

    for (const notification of activeNotifications) {
      const { userId, teamName, eventId, endTime, messageId, channelId, _id } =
        notification;
      const remainingTime = new Date(endTime).getTime() - Date.now();
      const jobTime = new Date(endTime);

      if (remainingTime > 0) {
        schedule.scheduleJob(jobTime, async () => {
          try {
            const events = await getCollection("events");

            // Удаляем игрока из команды
            const playerRemoved = await removePlayerFromTeam(
              userId,
              teamName,
              eventId
            );

            if (!playerRemoved) return;
            const event = await events.findOne({ eventId });
            if (!event) return;
            // Обновляем Embed в канале события
            await updateEventEmbed(client, event);

            // Отправляем уведомление пользователю в DM (по умолчанию английский)
            try {
              const user = await client.users.fetch(userId);
              if (user) {
                await user.send(dmMessages.dmRemoval.en(teamName));
              }
            } catch (dmError) {
              console.error(
                `Не удалось отправить уведомление пользователю ${userId}:`,
                dmError
              );
            }

            // Удаление сообщения с уведомлением в DM
            if (messageId && channelId) {
              try {
                const dmChannel = await client.channels.fetch(channelId);
                if (dmChannel) {
                  const message = await dmChannel.messages.fetch(messageId);
                  if (message) {
                    await message.delete();
                    console.log(
                      `Сообщение с ID ${messageId} удалено из DM-канала ${channelId}.`
                    );
                  }
                }
              } catch (msgError) {
                console.error(
                  `Ошибка при удалении DM сообщения ${messageId} из канала ${channelId}:`,
                  msgError
                );
              }
            }

            // Удаляем уведомление из базы
            await deleteNotification(_id);
          } catch (error) {
            console.error(`Ошибка при удалении игрока ${userId}:`, error);
          }
        });
      }
    }

    console.log(
      `Восстановлено ${activeNotifications.length} активных таймеров.`
    );
  } catch (error) {
    console.error("Ошибка при восстановлении таймеров:", error);
  }
};
