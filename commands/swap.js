import { SlashCommandBuilder } from "discord.js";
import { getCollection } from "../utils/mongodb.js";
import { updateEventEmbed } from "../utils/updateEventEmbed.js";

export const data = new SlashCommandBuilder()
  .setName("swap")
  .setDescription("Заменить игрока из команды игроком из скамьи запасных.")
  .addStringOption((option) =>
    option
      .setName("steamid")
      .setDescription("Ваш SteamID, как указано в списке запасных")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("teamname")
      .setDescription(
        "Название команды, в которую хотите вступить или заменить игрока"
      )
      .setRequired(true)
  );

export const execute = async (interaction) => {
  // Ответ делаем эфемерным
  await interaction.deferReply({ ephemeral: true });

  // Получаем параметры команды
  const steamid = interaction.options.getString("steamid");
  const teamname = interaction.options.getString("teamname");

  const eventsCollection = await getCollection("events");

  // Ищем активное событие (можно добавить и дополнительный фильтр, если нужно)
  const event = await eventsCollection.findOne({ status: "active" });
  if (!event) {
    await interaction.editReply("Активное событие не найдено.");
    return;
  }

  // Проверяем, что в скамье запасных есть игрок с указанным SteamID
  if (!event.substitutes || event.substitutes.length === 0) {
    await interaction.editReply("В скамье запасных нет ни одного игрока.");
    return;
  }
  const substituteIndex = event.substitutes.findIndex(
    (sub) => sub.steamId === steamid
  );
  if (substituteIndex === -1) {
    await interaction.editReply(
      "Игрок с указанным SteamID не найден в списке запасных."
    );
    return;
  }
  const substitute = event.substitutes[substituteIndex];

  // Находим команду по имени (без учёта регистра)
  const teamIndex = event.teams.findIndex(
    (team) => team.name.toLowerCase() === teamname.toLowerCase()
  );
  if (teamIndex === -1) {
    await interaction.editReply("Команда с указанным именем не найдена.");
    return;
  }
  const team = event.teams[teamIndex];

  // Определяем максимальное число участников в команде (если не указано, считаем, что места не ограничены)
  const maxPlayers = event.maxPlayersPerTeam || Infinity;

  let replacedPlayer = null;
  if (team.members.length >= maxPlayers) {
    // Если команда заполнена, заменяем первого участника
    replacedPlayer = team.members.shift();
    // Добавляем заменённого игрока в скамью запасных
    if (!event.substitutes) event.substitutes = [];
    event.substitutes.push(replacedPlayer);
  }

  // Добавляем запасного в состав команды
  team.members.push(substitute);
  // Удаляем игрока из скамьи запасных
  event.substitutes.splice(substituteIndex, 1);

  // Обновляем данные события в базе
  const updateResult = await eventsCollection.updateOne(
    { eventId: event.eventId },
    { $set: { teams: event.teams, substitutes: event.substitutes } }
  );
  if (updateResult.modifiedCount === 0) {
    await interaction.editReply("Не удалось обновить данные о событии.");
    return;
  }

  // Обновляем эмбед события
  await updateEventEmbed(interaction.client, event);

  // Формируем ответ для пользователя
  if (replacedPlayer) {
    await interaction.editReply(
      `Вы успешно заменили игрока <@${replacedPlayer.userId}> в команде **${team.name}**.`
    );
  } else {
    await interaction.editReply(
      `Вы успешно вступили в команду **${team.name}**.`
    );
  }
};

export default { data, execute };
