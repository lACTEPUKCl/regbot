import { SlashCommandBuilder } from "discord.js";
import { getCollection } from "../utils/mongodb.js";
import { updateEventEmbed } from "../utils/updateEventEmbed.js";

export const data = new SlashCommandBuilder()
  .setName("swap")
  .setDescription(
    "Заменить игрока из команды (по Steam ID) игроком из скамьи запасных."
  )
  // Опция для указания SteamID запасного
  .addStringOption((option) =>
    option
      .setName("substitute")
      .setDescription("Ваш SteamID, как указано в списке запасных")
      .setRequired(true)
  )
  // Опция для указания SteamID игрока, которого нужно заменить
  .addStringOption((option) =>
    option
      .setName("target")
      .setDescription("SteamID игрока, которого вы хотите заменить")
      .setRequired(true)
  )
  // Опциональная опция для указания ID события
  .addStringOption((option) =>
    option
      .setName("eventid")
      .setDescription("ID события (если не указан — берётся активное событие)")
      .setRequired(false)
  );

export const execute = async (interaction) => {
  // Ответ делаем эфемерным и откладываем его
  await interaction.deferReply({ ephemeral: true });

  // Получаем параметры команды
  const substituteSteamId = interaction.options.getString("substitute");
  const targetSteamId = interaction.options.getString("target");
  const eventIdOption = interaction.options.getString("eventid");

  const eventsCollection = await getCollection("events");

  // Если указан eventid, ищем событие по нему, иначе — активное событие
  let event;
  if (eventIdOption) {
    event = await eventsCollection.findOne({ eventId: eventIdOption });
  } else {
    event = await eventsCollection.findOne({ status: "active" });
  }

  if (!event) {
    await interaction.editReply("Событие не найдено.");
    return;
  }

  // Проверяем наличие запасного по SteamID в скамье
  if (!event.substitutes || event.substitutes.length === 0) {
    await interaction.editReply("Скамья запасных пуста.");
    return;
  }
  const substituteIndex = event.substitutes.findIndex(
    (sub) => sub.steamId === substituteSteamId
  );
  if (substituteIndex === -1) {
    await interaction.editReply("Запасной с указанным SteamID не найден.");
    return;
  }
  const substitute = event.substitutes[substituteIndex];

  // Ищем целевого игрока (target) по его SteamID во всех командах
  let teamFound = null;
  let teamIndex = -1;
  let targetIndex = -1;
  for (let i = 0; i < event.teams.length; i++) {
    const team = event.teams[i];
    const index = team.members.findIndex(
      (member) => member.steamId === targetSteamId
    );
    if (index !== -1) {
      teamFound = team;
      teamIndex = i;
      targetIndex = index;
      break;
    }
  }
  if (!teamFound) {
    await interaction.editReply(
      "Игрок с указанным SteamID не найден в составе ни одной команды."
    );
    return;
  }
  const target = teamFound.members[targetIndex];

  // Обмен:
  // Удаляем target из состава команды
  teamFound.members.splice(targetIndex, 1);
  // Удаляем запасного из скамьи
  event.substitutes.splice(substituteIndex, 1);
  // Добавляем запасного в состав команды
  teamFound.members.push(substitute);
  // Перемещаем target в скамью запасных
  event.substitutes.push(target);

  // Обновляем данные события в базе
  const updateResult = await eventsCollection.updateOne(
    { eventId: event.eventId },
    { $set: { teams: event.teams, substitutes: event.substitutes } }
  );
  if (updateResult.modifiedCount === 0) {
    await interaction.editReply("Не удалось обновить данные о событии.");
    return;
  }

  // Обновляем эмбед события (функция updateEventEmbed учитывает сумму numberPlayers)
  await updateEventEmbed(interaction.client, event);

  await interaction.editReply(
    `Успешно заменён игрок с SteamID **${targetSteamId}** на запасного с SteamID **${substituteSteamId}**.`
  );
};

export default { data, execute };
