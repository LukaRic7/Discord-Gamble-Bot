const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');

/**
 * Calculates the number of hours elapsed since the last claim.
 *
 * Returns a default value if no previous claim date exists.
 *
 * @param {string|null} lastClaimDate - The timestamp of the user's last claim.
 * @returns {number} The number of hours passed since the last claim.
 */
function getDiffHours(lastClaimDate) {
    if (!lastClaimDate) return 30;

    const last = new Date(lastClaimDate.replace(' ', 'T') + 'Z');
    const now = new Date();

    const diffHours = (now - last) / (1000 * 60 * 60);

    return diffHours;
}

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily bonus.')
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
            const data = await db.getDailyData(userId);

            const diffHours = getDiffHours(data.last_daily_claim);

            // Check if 24 hours passed
            if (diffHours < 24) {
                const last = new Date(data.last_daily_claim.replace(' ', 'T') + 'Z');

                const embed = new EmbedBuilder()
                    .setAuthor(buildAuthor(interaction))
                    .setDescription(`:hourglass: Your daily bonus is available again <t:${Math.floor((last.getTime() / 1000) + 60 * 60 * 24)}:R>`)
                    .setColor(Colors.RED)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });
            
                return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            // Calculate streak
            let streak = data.daily_streak ?? 0;
            if (diffHours > 48) streak = 0;
            streak += 1;
            
            // Calculate reward and claim it
            const reward = 250 * (1 + (0.05 * (streak - 1)));
            const updatedProfile = await db.claimDaily(userId, reward, streak);

            // Build the embed to show the successful daily claim
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':credit_card: You Claimed Your Daily!')
                .setDescription(diffHours > 48 ? '\n\n:broken_chain: You broke your streak!' : ':muscle: Your streak is ongoing!')
                .setFields(
                    { name: 'Received', value: formatBalance(reward, true), inline: true },
                    { name: 'Streak', value: `:fire: ${streak}`, inline: true },
                    { name: 'Total Claims', value: `${data.total_dailys + 1}`, inline: true },
                    { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                )
                .setColor(Colors.GREEN)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}