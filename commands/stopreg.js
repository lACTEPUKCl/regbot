import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { getCollection } from "../utils/mongodb.js";

const stopreg = new SlashCommandBuilder()
  .setName("stopreg")
  .setDescription("Остановить регистрацию на турнир")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("eventid")
      .setDescription("ID события для остановки регистрации")
      .setRequired(true)
  );

const execute = async (interaction) => {
  const eventId = interaction.options.getString("eventid");

  try {
    const events = await getCollection("events");

    // Ищем событие по указанному eventId
    const event = await events.findOne({ eventId });
    if (!event) {
      await interaction.reply({
        content: `Событие с ID ${eventId} не найдено.`,
        ephemeral: true,
      });
      return;
    }

    // Проверяем, не остановлена ли регистрация уже ранее
    if (event.status === "stopped") {
      await interaction.reply({
        content: `Регистрация для события с ID ${eventId} уже остановлена.`,
        ephemeral: true,
      });
      return;
    }

    // Обновляем статус события на "stopped"
    await events.updateOne({ eventId }, { $set: { status: "stopped" } });

    // Получаем канал, в котором опубликовано сообщение события
    const channel = interaction.guild.channels.cache.get(event.channelId);
    if (!channel) {
      await interaction.reply({
        content: "Канал, связанный с этим событием, не найден.",
        ephemeral: true,
      });
      return;
    }

    // Получаем сообщение события по eventId и убираем кнопки (компоненты)
    const message = await channel.messages.fetch(eventId);
    if (message) {
      await message.edit({ components: [] });
      console.log(`Кнопки для события ${eventId} успешно удалены.`);
    } else {
      console.warn(`Сообщение события с ID ${eventId} не найдено.`);
    }

    await interaction.reply({
      content: `Регистрация для события с ID ${eventId} успешно остановлена.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error("Ошибка при остановке регистрации:", error);
    await interaction.reply({
      content: "Произошла ошибка при остановке регистрации.",
      ephemeral: true,
    });
  }
};

export default { data: stopreg, execute };
