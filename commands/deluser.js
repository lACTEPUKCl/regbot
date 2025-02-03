import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { MongoClient } from "mongodb";

const deluser = new SlashCommandBuilder()
  .setName("deluser")
  .setDescription("Удалить пользователя из всех команд по Steam ID")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("steamid")
      .setDescription("Steam ID пользователя")
      .setRequired(true)
  );

const execute = async (interaction) => {
  const steamId = interaction.options.getString("steamid");
  const mongoClient = new MongoClient(process.env.MONGO_URI);

  try {
    await mongoClient.connect();
    const db = mongoClient.db("SquadJS");
    const events = db.collection("events");

    // Находим все события с командами, содержащими данного пользователя
    const affectedEvents = await events
      .find({
        "teams.members.steamId": steamId,
      })
      .toArray();

    if (affectedEvents.length === 0) {
      await interaction.reply({
        content: `Пользователь с Steam ID ${steamId} не найден в списках команд.`,
        ephemeral: true,
      });
      return;
    }

    for (const event of affectedEvents) {
      // Удаляем пользователя из всех команд
      event.teams.forEach((team) => {
        team.members = team.members.filter(
          (member) => member.steamId !== steamId
        );
      });

      // Обновляем данные события в базе
      await events.updateOne(
        { eventId: event.eventId },
        { $set: { teams: event.teams } }
      );

      // Обновляем эмбед
      const eventChannel = interaction.guild.channels.cache.get(
        event.channelId
      );
      if (!eventChannel) {
        console.error(`Канал с ID ${event.channelId} не найден.`);
        continue;
      }

      const message = await eventChannel.messages
        .fetch(event.eventId)
        .catch(() => null);
      if (!message) {
        console.error(`Сообщение с ID ${event.eventId} не найдено.`);
        continue;
      }

      const maxPlayersPerTeam = event.maxPlayersPerTeam || "∞";

      // Обновляем поля эмбеда
      const updatedFields = event.teams.map((team) => ({
        name: `${team.name} (${team.members.length}/${maxPlayersPerTeam})`,
        value:
          team.members
            .map((member) => `${member.nickname} (${member.steamId})`)
            .join("\n") || "-",
        inline: true,
      }));

      const existingEmbed = message.embeds?.[0];
      const updatedEmbed = existingEmbed
        ? EmbedBuilder.from(existingEmbed)
        : new EmbedBuilder()
            .setTitle("Регистрация на турнир")
            .setColor("#3498DB");

      updatedEmbed.setFields(updatedFields);

      await message.edit({ embeds: [updatedEmbed] });
    }

    await interaction.reply({
      content: `Пользователь с Steam ID ${steamId} успешно удалён из всех команд.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "Произошла ошибка при удалении пользователя.",
      ephemeral: true,
    });
  } finally {
    await mongoClient.close();
  }
};

export default { data: deluser, execute };
