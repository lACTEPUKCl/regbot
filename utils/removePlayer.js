import { getCollection } from "../utils/mongodb.js";

export const removePlayerFromTeam = async (userId, teamName, eventId) => {
  try {
    const events = await getCollection("events");
    const event = await events.findOne({ eventId });

    if (!event) return false;

    const team = event.teams.find((t) => t.name === teamName);
    if (!team) return false;

    let removed = false;
    team.members = team.members.filter((m) => {
      if (m.userId === userId) {
        removed = true;
        return false;
      }
      return true;
    });

    if (!removed) return false;

    await events.updateOne(
      { eventId: event.eventId },
      { $set: { teams: event.teams } }
    );

    console.log(`Игрок ${userId} удалён из команды ${teamName}.`);
    return true;
  } catch (error) {
    console.error(`Ошибка при удалении игрока ${userId}:`, error);
    return false;
  }
};
