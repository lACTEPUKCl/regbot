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
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("event_type")
      .setDescription("Выберите тип ивента: clan или solo")
      .setRequired(true)
      .addChoices(
        { name: "Clan", value: "clan" },
        { name: "Solo", value: "solo" }
      )
  );

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
      return getImageFromUser(dmChannel);
    }
    return imageAttachment.url;
  } catch (error) {
    await dmChannel.send("Время ожидания истекло. Попробуйте снова.");
    return getImageFromUser(dmChannel);
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
      return getInputFromUser(dmChannel, question, validationFn);
    }
    return input;
  } catch (error) {
    await dmChannel.send("Время ожидания истекло. Попробуйте снова.");
    return getInputFromUser(dmChannel, question, validationFn);
  }
};

const execute = async (interaction) => {
  let hasReplied = false; // Флаг, чтобы убедиться, что ответ отправлен только один раз

  // Получаем тип ивента из опций (clan или solo)
  const eventType = interaction.options.getString("event_type").toLowerCase();
  const user = interaction.user;

  // Создаем DM-канал
  const dmChannel = await user.createDM().catch((error) => {
    console.error("Ошибка при создании DM-канала:", error.message);
    return null;
  });
  if (!dmChannel) {
    if (!hasReplied) {
      await interaction.reply({
        content:
          "Не удалось отправить сообщение в личные сообщения. Проверьте настройки конфиденциальности.",
        ephemeral: true,
      });
      hasReplied = true;
    }
    return;
  }

  // Уведомляем пользователя, что дальнейшая настройка будет в ЛС
  if (!hasReplied) {
    await interaction.reply({
      content: "Проверьте личные сообщения для продолжения настройки события.",
      ephemeral: true,
    });
    hasReplied = true;
  }

  // Запрашиваем описание турнира (например, до 2000 символов)
  const text = await getInputFromUser(
    dmChannel,
    "Введите описание турнира (не более 2000 символов):",
    (input) => input.length > 0 && input.length <= 2000
  );

  // Запрашиваем список команд (от 1 до 25, каждое не длиннее 50 символов)
  const teamsInput = await getInputFromUser(
    dmChannel,
    "Введите список команд через запятую",
    (input) => {
      if (!input.trim()) return false;
      const arr = input.split(",");
      if (arr.length === 0 || arr.length > 25) return false;
      return arr.every(
        (team) => team.trim().length > 0 && team.trim().length <= 50
      );
    }
  );
  const teams = teamsInput.split(",").map((team) => team.trim());

  // Запрашиваем число участников в команде
  const maxPlayersPerTeamInput = await getInputFromUser(
    dmChannel,
    "Введите число участников в команде (от 1 до 50):",
    (input) => {
      const num = parseInt(input, 10);
      return !isNaN(num) && num > 0 && num <= 50;
    }
  );
  const maxPlayersPerTeam = parseInt(maxPlayersPerTeamInput, 10);

  // Запрашиваем изображение
  const imageUrl = await getImageFromUser(dmChannel);

  // Формируем Embed для регистрации (без описания, чтобы оно выводилось отдельно)
  const embed = new EmbedBuilder()
    .setTitle("Регистрация на турнир")
    .setImage(imageUrl)
    .setColor("#3498DB");
  teams.forEach((team) => {
    embed.addFields({
      name: `${team} (0/${maxPlayersPerTeam})`,
      value: "-",
      inline: true,
    });
  });

  // Ищем канал для публикации события (например, канал с именем "test")
  const eventChannel = interaction.guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === "test"
  );
  if (!eventChannel) {
    if (!hasReplied) {
      await dmChannel.send("Ошибка: канал для публикации событий не найден.");
      hasReplied = true;
    }
    return;
  }

  // Создаем временные placeholder-кнопки
  const placeholderRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("register_placeholder")
      .setLabel("Регистрация")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancel_placeholder")
      .setLabel("Отмена")
      .setStyle(ButtonStyle.Danger)
  );

  // Отправляем сообщение с описанием турнира (content) и Embed (без текста)
  const message = await eventChannel.send({
    content: text,
    embeds: [embed],
    components: [placeholderRow],
  });

  // Создаем обновленный ряд кнопок с использованием message.id и выбранного типа ивента
  const updatedRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`register_${eventType}_${message.id}`)
      .setLabel("Регистрация")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancel_${eventType}_${message.id}`)
      .setLabel("Отмена")
      .setStyle(ButtonStyle.Danger)
  );
  await message.edit({
    components: [updatedRow],
  });

  // Сохраняем событие в базе
  try {
    const events = await getCollection("events");
    await events.insertOne({
      eventId: message.id,
      channelId: eventChannel.id,
      guildId: interaction.guild.id,
      text,
      imageUrl,
      eventType,
      status: "active",
      teams: teams.map((team) => ({ name: team, members: [] })),
      maxPlayersPerTeam,
      createdBy: user.id,
      createdAt: new Date(),
    });
    if (!hasReplied) {
      await dmChannel.send("Регистрация успешно создана!");
      hasReplied = true;
    }
  } catch (error) {
    console.error(error);
    if (!hasReplied) {
      await dmChannel.send("Произошла ошибка при сохранении события.");
      hasReplied = true;
    }
  }
};

export default { data: startreg, execute };
