const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

const DIE_EMOJIS = ['0', ':one:', ':two:', ':three:', ':four:', ':five:', ':six:'];

/**
 * Rolls two six-sided dice and returns the resulting values.
 * @returns {[number, number]} An array containing the result of the first and second die roll.
 */
const rollDice = () => [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1
];

/**
 * Analyzes a dice roll and returns detailed information about the result.
 *
 * Determines whether the roll is a pair, calculates the total value,
 * assigns a ranking value, creates a display name, and formats the dice
 * output using emoji representations.
 *
 * @param {[number, number]} dice - An array containing the two rolled dice values.
 *
 * @returns {Object} The analyzed dice roll information.
 * @returns {[number, number]} returns.dice - The original dice values.
 * @returns {number} returns.a - The first die value.
 * @returns {number} returns.b - The second die value.
 * @returns {number} returns.sum - The sum of both dice.
 * @returns {boolean} returns.isPair - Whether both dice show the same value.
 * @returns {number|null} returns.pairValue - The matching die value if the roll is a pair, otherwise null.
 * @returns {number} returns.rankValue - The numeric ranking value used to compare rolls.
 * @returns {string} returns.rankName - Human-readable name of the roll.
 * @returns {string} returns.display - Emoji representation of the dice roll.
 */
const describeRoll = (dice) => {
    const [a, b] = dice;
    const isPair = a === b;
    const sum = a + b;
    const rankValue = isPair ? 100 + a : sum;
    const rankName = isPair ? `Pair ${a}` : `Total ${sum}`;

    return {
        dice, a, b, sum, isPair, pairValue: isPair ? a : null, rankValue,
        rankName, display: `${DIE_EMOJIS[a]} ${DIE_EMOJIS[b]}`
    };
};

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Roll a pair of dice against a dealer, highest sum wins.')
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
        const stake = Math.floor(interaction.options.getNumber('stake'));
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(interaction.user.id);
            if (profile.balance < stake) {
                return await interaction.reply({ embeds: [await createInsufficientMoneyEmbed(interaction, stake)] });
            }

            let playerRoll;
            let dealerRoll;

            do {
                playerRoll = describeRoll(rollDice());
                dealerRoll = describeRoll(rollDice());
            } while (playerRoll.rankValue === dealerRoll.rankValue);

            // Calculate values and update the database
            const playerWins = playerRoll.rankValue > dealerRoll.rankValue;
            const resultType = playerRoll.isPair ? 'pair' : 'regular';
            const isPairSix = playerRoll.isPair && playerRoll.pairValue === 6;
            const multiplier = playerWins ? isPairSix ? 5.0 : playerRoll.isPair ? 2.5 : 1.8 : 0;
            const payout = playerWins ? Math.floor(stake * multiplier) : 0;
            const profit = playerWins ? Math.floor(payout - stake) : -stake;
            const updatedProfile = await db.recordGamePlay(interaction.user.id, stake, payout);
            const diceStats = await db.getDiceStats(interaction.user.id);
            const currentStreak = diceStats ? (diceStats.current_win_streak || 0) : 0;
            const newStreak = playerWins ? currentStreak + 1 : 0;
            await db.setDiceStats(interaction.user.id, newStreak);

            // Build the embed to show the results
            const resultEmbed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':game_die: Dice Result')
                .setDescription(playerWins ? ':trophy: You won!' : ':x: You lost!')
                .addFields(
                    { name: 'Your Roll', value: `${playerRoll.display}\n-# ${playerRoll.rankName}`, inline: true },
                    { name: 'Dealer Roll', value: `${dealerRoll.display}\n-# ${dealerRoll.rankName}`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                    { name: 'Stake', value: formatBalance(stake), inline: true },
                    { name: 'Profit', value: formatBalance(profit, true), inline: true },
                    { name: 'Streak', value: `:fire: ${newStreak}`, inline: true },
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