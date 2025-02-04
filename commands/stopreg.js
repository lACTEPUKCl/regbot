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

    // Проверяем, существует ли событие
    const event = await events.findOne({ eventId });

    if (!event) {
      await interaction.reply({
        content: `Событие с ID ${eventId} не найдено.`,
        ephemeral: true,
      });
      return;
    }

    // Проверяем, активное ли событие
    if (event.status === "stopped") {
      await interaction.reply({
        content: `Регистрация на это событие уже остановлена.`,
        ephemeral: true,
      });
      return;
    }

    // Обновляем статус события
    await events.updateOne({ eventId }, { $set: { status: "stopped" } });

    // Убираем кнопки из сообщения
    const channel = interaction.guild.channels.cache.get(event.channelId);
    if (!channel) {
      await interaction.reply({
        content: "Канал, связанный с этим событием, не найден.",
        ephemeral: true,
      });
      return;
    }

    const message = await channel.messages.fetch(eventId);
    if (message) {
      await message.edit({ components: [] });
    }

    await interaction.reply({
      content: `Регистрация на событие с ID ${eventId} успешно остановлена.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "Произошла ошибка при остановке регистрации.",
      ephemeral: true,
    });
  }
};

export default { data: stopreg, execute };
