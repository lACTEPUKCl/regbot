import { SlashCommandBuilder } from "discord.js";
import { MongoClient } from "mongodb";

const delevent = new SlashCommandBuilder()
  .setName("delevent")
  .setDescription("Удалить событие")
  .addStringOption((option) =>
    option
      .setName("eventid")
      .setDescription("ID события для удаления")
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

    // Удаляем событие из базы данных
    await events.deleteOne({ eventId });

    // Удаляем сообщение из канала
    const channel = interaction.guild.channels.cache.get(event.channelId);
    if (!channel) {
      await interaction.reply({
        content:
          "Канал, связанный с этим событием, не найден. Событие удалено из базы данных.",
        ephemeral: true,
      });
      return;
    }

    const message = await channel.messages.fetch(eventId).catch(() => null);
    if (message) {
      await message.delete();
    }

    await interaction.reply({
      content: `Событие с ID ${eventId} успешно удалено.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "Произошла ошибка при удалении события.",
      ephemeral: true,
    });
  } finally {
    await mongoClient.close();
  }
};

export default { data: delevent, execute };
