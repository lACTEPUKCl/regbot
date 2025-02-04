import { EmbedBuilder } from "discord.js";

export const updateEventEmbed = async (client, event) => {
  try {
    // Обновляем Embed с регистрацией
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

    const maxPlayersPerTeam = event.maxPlayersPerTeam || "∞";

    // Генерируем новый Embed
    const updatedEmbed = EmbedBuilder.from(eventMessage.embeds[0]).setFields(
      event.teams.map((team) => ({
        name: `${team.name} (${team.members.length}/${maxPlayersPerTeam})`,
        value:
          team.members
            .map((member) => `${member.nickname} (${member.steamId})`)
            .join("\n") || "-",
        inline: true,
      }))
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
