const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

const CARD_RANKS = [
    { label: ':regional_indicator_a:', value: 1, name: 'A' },
    { label: ':two:', value: 2, name: '2' },
    { label: ':three:', value: 3, name: '3' },
    { label: ':four:', value: 4, name: '4' },
    { label: ':five:', value: 5, name: '5' },
    { label: ':six:', value: 6, name: '6' },
    { label: ':seven:', value: 7, name: '7' },
    { label: ':eight:', value: 8, name: '8' },
    { label: ':nine:', value: 9, name: '9' },
    { label: ':keycap_ten:', value: 10, name: '10' },
    { label: ':regional_indicator_j:', value: 11, name: 'J' },
    { label: ':regional_indicator_q:', value: 12, name: 'Q' },
    { label: ':regional_indicator_k:', value: 13, name: 'K' }
];

const drawCard = () => CARD_RANKS[Math.floor(Math.random() * CARD_RANKS.length)];

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('war')
        .setDescription('Pull a card against a dealer, highest card wins.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(100)
            .setMaxValue(500)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
        
    // Callback for when the command is executed
    async execute(interaction) {
        const stake = interaction.options.getNumber('stake');
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(interaction.user.id);
            
            // Make sure the user has enough money
            if (profile.balance < stake) {
                return await interaction.reply({ embeds: [await createInsufficientMoneyEmbed(interaction, stake)] });
            }

            let playerCard;
            let dealerCard;

            do {
                playerCard = drawCard();
                dealerCard = drawCard();
            } while (playerCard.value === dealerCard.value);

            // Update the database
            const playerWins = playerCard.value > dealerCard.value;
            const payout = playerWins ? stake * 2 : 0;
            const updatedProfile = await db.recordGamePlay(interaction.user.id, stake, payout);
            const warStats = await db.getWarStats(interaction.user.id);
            const currentStreak = warStats ? (warStats.current_win_streak ?? 0) : 0;
            const newStreak = playerWins ? currentStreak + 1 : 0;
            await db.setWarStats(interaction.user.id, playerCard.name === 'K', newStreak);

            // Build the embed to show results
            const resultEmbed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':crossed_swords: War Result')
                .setDescription(playerWins ? ':trophy: You won!' : ':x: You lost!')
                .addFields(
                    { name: 'Your Card', value: `${playerCard.label}`, inline: true },
                    { name: 'Dealer Card', value: `${dealerCard.label}`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                    { name: 'Stake', value: formatBalance(stake), inline: true },
                    { name: 'Profit', value: formatBalance(playerWins ? stake : -stake, true), inline: true },
                    { name: 'Win Streak', value: `:fire: ${newStreak}`, inline: true },
                    { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                )
                .setColor(playerWins ? Colors.GREEN : Colors.RED)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [resultEmbed] });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
};