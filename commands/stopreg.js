import { SlashCommandBuilder } from "discord.js";
import { MongoClient } from "mongodb";

const stopreg = new SlashCommandBuilder()
  .setName("stopreg")
  .setDescription("Остановить регистрацию на турнир")
  .addStringOption((option) =>
    option
      .setName("eventid")
      .setDescription("ID события для остановки регистрации")
      .setRequired(true)
  );

const execute = async (interaction) => {
  const eventId = interaction.options.getString("eventid");
  const mongoClient = new MongoClient(process.env.MONGO_URI);

  try {
    await mongoClient.connect();
    const db = mongoClient.db("SquadJS");
    const events = db.collection("events");

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
  } finally {
    await mongoClient.close();
  }
};

export default { data: stopreg, execute };
