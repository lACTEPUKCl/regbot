import { getCollection } from "../utils/mongodb.js";

export const deleteNotification = async (notificationId) => {
  try {
    const notifications = await getCollection("notifications");
    await notifications.deleteOne({ _id: notificationId });
    console.log(`Уведомление ${notificationId} удалено из базы.`);
  } catch (error) {
    console.error(`Ошибка при удалении уведомления ${notificationId}:`, error);
  }
};
