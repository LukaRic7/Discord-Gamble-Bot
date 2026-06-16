const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createUserDoesNotExistEmbed } = require('../utils/standard_embeds.js');

// Format a number into an integer with comma thousand seperator
const thousandSeperator = Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 2
});

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('View the top 10 balance leaderboard.')
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    // Callback for when the command is executed
    async execute(interaction) {
        const db = interaction.client.db;
        const userId = interaction.user.id;

        try {
            const leaderboard = await db.getLeaderboard();

            const ownPlace = leaderboard.findIndex(user => user.userId === userId);

            const rankEmojis = { 0: ':first_place:', 1: ':second_place:', 2: ':third_place:' };

            const users = await Promise.all(
                leaderboard.map(entry => interaction.client.users.fetch(entry.userId).catch(() => null))
            );

            const fields = leaderboard.map((entry, index) => {
                const user = users[index];

                const name = user ? (user.globalName || user.username) : 'Unknown User';
                const emoji = rankEmojis[index] || `#${index + 1}`;

                return {
                    name: `${emoji} - ${name}`,
                    value: `:moneybag: **${formatBalance(entry.balance)}**`,
                    inline: false
                };
            });

            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(
                    ownPlace !== -1
                        ? `You are in place **#${thousandSeperator.format(ownPlace + 1)}** of **${thousandSeperator.format(leaderboard.length)}**`
                        : 'You do not have a gambling account.'
                )
                .setFields(fields)
                .setColor(Colors.CORE)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            await handleInteractionError(interaction, error);
        }
    }
}