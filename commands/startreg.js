import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { getCollection } from "../utils/mongodb.js";

const startreg = new SlashCommandBuilder()
  .setName("startreg")
  .setDescription("Запуск регистрации на турнир")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const getImageFromUser = async (dmChannel) => {
  try {
    await dmChannel.send("Отправьте изображение для эмбеда:");
    const collected = await dmChannel.awaitMessages({
      filter: (msg) => msg.attachments.size > 0,
      max: 1,
      time: 300000,
      errors: ["time"],
    });

    const imageAttachment = collected.first().attachments.first();
    if (!imageAttachment) {
      await dmChannel.send("Ошибка: изображение не найдено. Попробуйте снова.");
      return getImageFromUser(dmChannel); // Рекурсивный вызов для повторного ввода
    }

    return imageAttachment.url;
  } catch (error) {
    await dmChannel.send("Время ожидания истекло. Попробуйте снова.");
    return getImageFromUser(dmChannel); // Рекурсивный вызов для повторного ввода
  }
};

const getInputFromUser = async (dmChannel, question, validationFn = null) => {
  try {
    await dmChannel.send(question);
    const collected = await dmChannel.awaitMessages({
      max: 1,
      time: 300000,
      errors: ["time"],
    });

    const input = collected.first().content;

    if (validationFn && !validationFn(input)) {
      await dmChannel.send("Ошибка: некорректный ввод. Попробуйте снова.");
      return getInputFromUser(dmChannel, question, validationFn); // Рекурсивный вызов
    }

    return input;
  } catch (error) {
    await dmChannel.send("Время ожидания истекло. Попробуйте снова.");
    return getInputFromUser(dmChannel, question, validationFn); // Рекурсивный вызов
  }
};

const execute = async (interaction) => {
  const user = interaction.user;

  // Создаем канал личных сообщений
  const dmChannel = await user.createDM().catch((error) => {
    console.error("Ошибка при создании DM-канала:", error.message);
    return null;
  });

  if (!dmChannel) {
    await interaction.reply({
      content:
        "Не удалось отправить сообщение в личные сообщения. Проверьте настройки конфиденциальности.",
      ephemeral: true,
    });
    return;
  }

  // Уведомляем пользователя в сервере, что взаимодействие будет в ЛС
  await interaction.reply({
    content: "Проверьте личные сообщения для продолжения настройки события.",
    ephemeral: true,
  });

  // Запрашиваем текст для описания события
  const text = await getInputFromUser(
    dmChannel,
    "Введите текст для описания события:",
    (input) => input.length > 0
  );

  // Запрашиваем список команд
  const teamsInput = await getInputFromUser(
    dmChannel,
    "Введите список команд через запятую:",
    (input) => input.length > 0
  );
  const teams = teamsInput.split(",").map((team) => team.trim());

  // Запрашиваем число участников в команде
  const maxPlayersPerTeamInput = await getInputFromUser(
    dmChannel,
    "Введите число участников в команде:",
    (input) => !isNaN(parseInt(input, 10)) && parseInt(input, 10) > 0
  );
  const maxPlayersPerTeam = parseInt(maxPlayersPerTeamInput, 10);

  // Запрашиваем изображение
  const imageUrl = await getImageFromUser(dmChannel);

  const embed = new EmbedBuilder()
    .setTitle("Регистрация на турнир")
    .setDescription(`${text}`)
    .setImage(imageUrl)
    .setColor("#3498DB");

  teams.forEach((team) => {
    embed.addFields({
      name: `${team} (0/${maxPlayersPerTeam})`,
      value: "-",
      inline: true,
    });
  });

  // Кнопки для регистрации
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("register")
      .setLabel("Регистрация")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancel")
      .setLabel("Отмена")
      .setStyle(ButtonStyle.Danger)
  );

  // Отправляем сообщение в канал сервера
  const eventChannel = interaction.guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === "test"
  );

  if (!eventChannel) {
    await dmChannel.send("Ошибка: канал для публикации событий не найден.");
    return;
  }

  const message = await eventChannel.send({
    embeds: [embed],
    components: [row],
  });

  try {
    const events = await getCollection("events");

    await events.insertOne({
      eventId: message.id,
      channelId: eventChannel.id,
      guildId: interaction.guild.id,
      text,
      imageUrl,
      status: "active", // Событие активно
      teams: teams.map((team) => ({ name: team, members: [] })), // Список команд
      maxPlayersPerTeam, // Количество участников в команде
      createdBy: user.id,
      createdAt: new Date(),
    });

    await dmChannel.send("Регистрация успешно создана!");
  } catch (error) {
    console.error(error);
    await dmChannel.send("Произошла ошибка при сохранении события.");
  }
};

export default { data: startreg, execute };
