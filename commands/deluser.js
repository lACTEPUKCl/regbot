import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { getCollection } from "../utils/mongodb.js";

const deluser = new SlashCommandBuilder()
  .setName("deluser")
  .setDescription("Удалить пользователя из команд по Steam ID")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("steamid")
      .setDescription("Steam ID пользователя")
      .setRequired(true)
  )
  // Добавляем опциональный параметр eventid
  .addStringOption((option) =>
    option
      .setName("eventid")
      .setDescription("ID события, из которого удалить пользователя.")
      .setRequired(false)
  );

const execute = async (interaction) => {
  const steamId = interaction.options.getString("steamid");
  const eventIdOption = interaction.options.getString("eventid");

  try {
    const events = await getCollection("events");

    let affectedEvents;
    if (eventIdOption) {
      // Если указан eventId, ищем только по нему
      affectedEvents = await events
        .find({
          eventId: eventIdOption,
          "teams.members.steamId": steamId,
        })
        .toArray();
    } else {
      // Ищем во всех событиях, где есть участник с данным Steam ID
      affectedEvents = await events
        .find({ "teams.members.steamId": steamId })
        .toArray();
    }

    if (affectedEvents.length === 0) {
      await interaction.reply({
        content: `Пользователь с Steam ID ${steamId} не найден ${
          eventIdOption ? `в событии с ID ${eventIdOption}` : "во всех событиях"
        }.`,
        ephemeral: true,
      });
      return;
    }

    for (const event of affectedEvents) {
      // Удаляем пользователя из всех команд данного события
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

      // Обновляем эмбед сообщения события
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

      // Формируем обновленные поля эмбеда для каждой команды,
      // учитывая, что количество зарегистрированных игроков считается как сумма поля numberPlayers
      const updatedFields = event.teams.map((team) => {
        const registeredPlayers = team.members.reduce(
          (acc, member) => acc + (member.numberPlayers || 1),
          0
        );
        const membersText =
          team.members
            .map((member) => `${member.nickname} (${member.steamId})`)
            .join("\n") || "-";
        return {
          name: `${team.name} (${registeredPlayers}/${maxPlayersPerTeam})`,
          value: membersText,
          inline: true,
        };
      });

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
      content: `Пользователь с Steam ID ${steamId} успешно удалён ${
        eventIdOption ? `из события с ID ${eventIdOption}` : "из всех событий"
      }.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "Произошла ошибка при удалении пользователя.",
      ephemeral: true,
    });
  }
};

export default { data: deluser, execute };
