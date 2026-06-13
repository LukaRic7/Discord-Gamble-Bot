const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

const DIE_EMOJIS = ['0', ':one:', ':two:', ':three:', ':four:', ':five:', ':six:'];

const rollDice = () => [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1
];

const describeRoll = (dice) => {
    const [a, b] = dice;
    const isPair = a === b;
    const sum = a + b;
    const rankValue = isPair ? 100 + a : sum;
    const rankName = isPair ? `Pair ${a}` : `Total ${sum}`;

    return {
        dice,
        a,
        b,
        sum,
        isPair,
        pairValue: isPair ? a : null,
        rankValue,
        rankName,
        display: `${DIE_EMOJIS[a]} ${DIE_EMOJIS[b]}`
    };
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dice')
        .setDescription('Roll a pair of dice against a dealer, highest sum wins.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(250)
            .setMaxValue(1000)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),

    async execute(interaction) {
        const stake = Math.floor(interaction.options.getNumber('stake'));
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(interaction.user.id);
            if (profile.balance < stake) {
                return await interaction.reply({ embeds: [await createInsufficientMoneyEmbed(interaction, stake)] });
            }

            const loadingEmbed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':game_die: Dice')
                .setDescription('Rolling dice...')
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [loadingEmbed] });
            await wait(700);

            let playerRoll;
            let dealerRoll;
            let rounds = 0;

            do {
                playerRoll = describeRoll(rollDice());
                dealerRoll = describeRoll(rollDice());
                rounds += 1;
            } while (playerRoll.rankValue === dealerRoll.rankValue);

            const playerWins = playerRoll.rankValue > dealerRoll.rankValue;
            const resultType = playerRoll.isPair ? 'pair' : 'regular';
            const isPairSix = playerRoll.isPair && playerRoll.pairValue === 6;
            const multiplier = playerWins
                ? isPairSix ? 5.0 : playerRoll.isPair ? 2.5 : 1.8
                : 0;
            const payout = playerWins ? Math.floor(stake * multiplier) : 0;
            const profit = playerWins ? Math.floor(payout - stake) : -stake;

            const updatedProfile = await db.recordGamePlay(interaction.user.id, stake, payout);

            const diceStats = await db.getDiceStats(interaction.user.id);
            const currentStreak = diceStats ? (diceStats.current_win_streak || 0) : 0;
            const newStreak = playerWins ? currentStreak + 1 : 0;
            await db.setDiceStats(interaction.user.id, newStreak);

            const resultEmbed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':game_die: Dice Result')
                .setDescription(playerWins ? ':trophy: You won!' : ':x: You lost!')
                .addFields(
                    { name: 'Your Roll', value: `${playerRoll.display}\n**${playerRoll.rankName}**`, inline: true },
                    { name: 'Dealer Roll', value: `${dealerRoll.display}\n**${dealerRoll.rankName}**`, inline: true },
                    { name: 'Rounds', value: `${rounds}`, inline: true },
                    { name: 'Stake', value: formatBalance(stake), inline: true },
                    { name: 'Profit', value: formatBalance(profit, true), inline: true },
                    { name: 'New Balance', value: formatBalance(updatedProfile.balance), inline: true },
                    { name: 'Win Streak', value: `${newStreak}`, inline: true },
                    { name: 'Payout Multiplier', value: playerWins ? `${multiplier.toFixed(1)}x` : '0x', inline: true }
                )
                .setColor(playerWins ? Colors.GREEN : Colors.RED)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.editReply({ embeds: [resultEmbed] });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
};