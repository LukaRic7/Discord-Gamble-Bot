const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');

// Format a number into an integer with comma thousand seperator
const thousandSeperator = Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 2
});

/**
 * Builds a formatted nested text block for display.
 * @param {...string} rows - Lines of text to include inside the nested block.
 * @returns {string} A formatted string wrapped in a ```nestedtext code block.
 */
function buildField(...rows) {
    return '\`\`\`nestedtext\n' + rows.join('\n') + '\n\`\`\`';
}

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View gambling statistics for yourself or another user.')
        .addUserOption((option) => option
            .setName('user')
            .setDescription('The user to view stats for (leave blank for yourself).')
            .setRequired(false)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
        
    // Callback for when the command is executed
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const db = interaction.client.db;

        try {
            // Only create a profile if own stats is checked
            let profile;
            if (!interaction.options.getUser('user')) {
                profile = await db.ensureUser(targetUser.id);
            } else {
                profile = await db.getUser(targetUser.id);
            }

            // Make sure the user exists
            if (!profile) {
                return await interaction.reply({ embeds: [createUserDoesNotExistEmbed(targetUser.id)] });
            }

            const stats = await db.getAllStats(targetUser.id);
            const creationDate = new Date(profile.created_at.replace(' ', 'T') + 'Z');
            const creationUnix = Math.floor((creationDate.getTime() / 1000));

            // Build the embed to show all the stats
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction, targetUser))
                .setDescription(`This user created their gambling account <t:${creationUnix}:R> on <t:${creationUnix}:F>. Here is all they accomplished!`)
                .addFields(
                    {
                        name: ':bar_chart: General Profile',
                        value: buildField(
                            `Balance: ${formatBalance(stats.balance || 0)}`, `Wagered: ${formatBalance(stats.total_waged || 0)}`,
                            `Profit: ${formatBalance(stats.lifetime_profit || 0)}`, `Games Played: ${thousandSeperator.format(stats.total_games_played || 0)}`
                        ),
                        inline: true
                    },
                    {
                        name: ':money_with_wings: Transactions & Claims',
                        value: buildField(
                            `Given: ${formatBalance(stats.total_payed || 0)}`, `Received: ${formatBalance(stats.total_received || 0)}`,
                            `From Claims: ${formatBalance(stats.total_from_claims || 0)}`, `Total Dailys: ${stats.total_dailys || 0}`,
                            `Total Works: ${thousandSeperator.format(stats.total_works || 0)}`
                        ),
                        inline: true
                    },
                    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                    {
                        name: ':black_joker: Blackjack',
                        value: buildField(
                            `Hands: ${thousandSeperator.format(stats.bj_total_hands || 0)}`, `Naturals: ${stats.bj_natural_blackjacks || 0}`,
                            `Best Streak: ${stats.bj_longest_win_streak || 0}`
                        ),
                        inline: true
                    },
                    {
                        name: ':bomb: Mines',
                        value: buildField(
                            `Bombs Hit: ${thousandSeperator.format(stats.mines_bombs_hit || 0)}`, `Diamonds: ${thousandSeperator.format(stats.mines_diamonds_hit || 0)}`,
                            `Perfects: ${stats.mines_perfect_games || 0}`
                        ),
                        inline: true
                    },
                    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                    {
                        name: ':slot_machine: Slots',
                        value: buildField(`Jackpots: ${stats.slots_jackpots_hit || 0}`, `Best Streak: ${stats.slots_longest_win_streak || 0}`),
                        inline: true
                    },
                    {
                        name: ':package: Chests',
                        value: buildField(`Opened: ${thousandSeperator.format(stats.chests_total_opened || 0)}`, `Best Streak: ${stats.chests_longest_win_streak || 0}`),
                        inline: true
                    },
                    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                    {
                        name: ':coin: Coinflip',
                        value: buildField(`Best Streak: ${stats.coinflip_longest_win_streak || 0}`),
                        inline: true
                    },
                    {
                        name: ':chart_with_upwards_trend: Crash',
                        value: buildField(`Highest Mult: ${(stats.crash_highest_multiplier || 0).toFixed(2)}x`),
                        inline: true
                    },
                    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                    {
                        name: ':arrow_up: High/Low',
                        value: buildField(`Best Streak: ${stats.highlow_longest_streak || 0}`),
                        inline: true
                    },
                    {
                        name: ':small_red_triangle: Plinko',
                        value: buildField(`Edges Hit: ${stats.plinko_total_edge_hits || 0}`),
                        inline: true
                    },
                    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                )
                .setColor(Colors.CORE)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
};