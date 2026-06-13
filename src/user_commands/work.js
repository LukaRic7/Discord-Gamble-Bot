const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work and get a small bonus.')
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),

    // Callback for when the command is executed
    async execute(interaction) {
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);
            const data = await db.getWorkData(userId);

            const last = new Date(data.last_work_claim.replace(' ', 'T') + 'Z');
            const now = new Date();
            const diffSeconds = (now - last) / 1000;
            
            // Check if 10 minutes passed
            if (diffSeconds < 600) {
                const embed = new EmbedBuilder()
                    .setAuthor(buildAuthor(interaction))
                    .setDescription(`:hourglass: Your work bonus is available again <t:${Math.floor((last.getTime() / 1000) + 600)}:R>`)
                    .setColor(Colors.RED)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });
            
                return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            // Calculate reward and claim it
            const reward = Math.random() * 5 + 5; // $ 5 - 10
            const updatedProfile = await db.claimWork(userId, reward);

            // Build the embed to show the successful work claim
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':credit_card: You Claimed Your Work Bonus!')
                .setFields(
                    { name: 'Received', value: formatBalance(reward, true), inline: true },
                    { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: true }
                )
                .setColor(Colors.GREEN)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            await interaction.reply({ embeds: [embed] });
        } catch {
            handleInteractionError(interaction, error);
        }
    }
}