import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCollection } from "../utils/mongodb.js";

export const data = new SlashCommandBuilder()
  .setName("substitutes")
  .setDescription("Получить список запасных участников события")
  .addStringOption((option) =>
    option
      .setName("eventid")
      .setDescription("ID события (если не указан — берётся активное событие)")
      .setRequired(false)
  );

export const execute = async (interaction) => {
  // Откладываем ответ с параметром ephemeral, чтобы ответ был виден только вызывающему
  await interaction.deferReply({ ephemeral: true });

  const eventIdOption = interaction.options.getString("eventid");
  const eventsCollection = await getCollection("events");
  let event;

  if (eventIdOption) {
    event = await eventsCollection.findOne({ eventId: eventIdOption });
  } else {
    // Если eventid не указан, ищем активное событие
    event = await eventsCollection.findOne({ status: "active" });
  }

  if (!event) {
    await interaction.editReply("Событие не найдено.");
    return;
  }

  // Получаем список запасных участников
  const substitutes = event.substitutes || [];

  if (substitutes.length === 0) {
    await interaction.editReply("В данном событии нет запасных участников.");
    return;
  }

  // Формируем строку со списком запасных с дополнительной информацией:
  // - Если указан clanTag – выводим его,
  // - Если указан numberPlayers (и он больше 1) – выводим количество игроков,
  // - Если присутствуют поля squadLeader и squadHours – выводим их для solo-ивентов.
  const substitutesList = substitutes
    .map((sub, index) => {
      const displayName = sub.nickname ? sub.nickname : "Без имени";
      const steamInfo = sub.steamId ? ` (SteamID: ${sub.steamId})` : "";
      const clanTag = sub.clanTag ? `[${sub.clanTag}] ` : "";
      const numberPlayers =
        sub.numberPlayers && sub.numberPlayers > 1
          ? `| Игроков: ${sub.numberPlayers}`
          : "";
      const squadLeader = sub.squadLeader ? `| SL: ${sub.squadLeader}` : "";
      const squadHours = sub.squadHours
        ? `| Часов в Squad: ${sub.squadHours}`
        : "";
      return `${index + 1}. <@${
        sub.userId
      }> — ${clanTag}${displayName}${steamInfo} ${numberPlayers} ${squadLeader} ${squadHours}`;
    })
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`Список запасных для события ${event.eventId}`)
    .setDescription(substitutesList)
    .setColor("Blue")
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
};

export default { data, execute };
