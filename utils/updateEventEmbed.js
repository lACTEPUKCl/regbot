import { EmbedBuilder } from "discord.js";

export const updateEventEmbed = async (client, event) => {
  try {
    // Получаем канал и сообщение события
    const eventChannel = await client.channels.fetch(event.channelId);
    if (!eventChannel) {
      console.error(`❌ Канал ${event.channelId} не найден.`);
      return;
    }

    const eventMessage = await eventChannel.messages.fetch(event.eventId);
    if (!eventMessage) {
      console.error(`❌ Сообщение события ${event.eventId} не найдено.`);
      return;
    }

    if (!eventMessage.editable) {
      console.error("❌ Бот не может редактировать это сообщение!");
      return;
    }

    // Определяем язык для Embed (если event.language не задан, по умолчанию "ru")
    const language = event.language || "ru";

    const maxPlayersPerTeam = event.maxPlayersPerTeam || "∞";

    // Обновляем поля Embed для каждой команды
    const updatedEmbed = EmbedBuilder.from(eventMessage.embeds[0]).setFields(
      event.teams.map((team) => {
        // Вычисляем общее число зарегистрированных игроков в команде
        const registeredPlayers = team.members.reduce(
          (acc, member) => acc + (member.numberPlayers || 1),
          0
        );

        // Формируем список участников
        const membersText =
          team.members
            .map((member) => {
              if (member.clanTag) {
                // Формат для clan-ивента
                return `[${member.clanTag}] ${member.nickname} (${member.steamId}) [${member.numberPlayers}]`;
              } else if (member.squadLeader || member.techSquad) {
                // Формат для solo-ивента:
                // Если значение squadLeader или techSquad равно "Да" или "Yes" – добавляем эмодзи и больше ничего.
                let prefix = "";
                if (
                  member.techSquad &&
                  (member.techSquad.toLowerCase() === "да" ||
                    member.techSquad.toLowerCase() === "yes")
                ) {
                  prefix = "⚙️ ";
                } else if (
                  member.squadLeader &&
                  (member.squadLeader.toLowerCase() === "да" ||
                    member.squadLeader.toLowerCase() === "yes")
                ) {
                  prefix = "⭐ ";
                }
                return `${prefix}${member.nickname} (${member.steamId}) - ${
                  member.squadHours
                } ${language.toLowerCase() === "ru" ? "ч." : "h."}`;
              } else {
                return `${member.nickname} (${member.steamId})`;
              }
            })
            .join("\n") || "-";

        return {
          name: `${team.name} (${registeredPlayers}/${maxPlayersPerTeam})`,
          value: membersText,
          inline: true,
        };
      })
    );

    if (!updatedEmbed.data.fields || updatedEmbed.data.fields.length === 0) {
      console.error("❌ Поля в Embed отсутствуют!");
      return;
    }

    await eventMessage.edit({ embeds: [updatedEmbed] });
    console.log(`✅ Обновлен Embed для события ${event.eventId}`);
  } catch (error) {
    console.error(
      `Ошибка при обновлении Embed для события ${event.eventId}:`,
      error
    );
  }
};
