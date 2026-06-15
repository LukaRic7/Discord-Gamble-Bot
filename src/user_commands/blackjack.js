const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
    
const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createTimedOutEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

// Hardcode card values
const suits = [':spades:', ':hearts:', ':diamonds:', ':clubs:'];
const ranks = [
    { rank: ':regional_indicator_a:', value: 11 },
    { rank: ':two:', value: 2 },
    { rank: ':three:', value: 3 },
    { rank: ':four:', value: 4 },
    { rank: ':five:', value: 5 },
    { rank: ':six:', value: 6 },
    { rank: ':seven:', value: 7 },
    { rank: ':eight:', value: 8 },
    { rank: ':nine:', value: 9 },
    { rank: ':keycap_ten:', value: 10 },
    { rank: ':regional_indicator_j:', value: 10 },
    { rank: ':regional_indicator_q:', value: 10 },
    { rank: ':regional_indicator_k:', value: 10 }
];

/**
 * Calculates the total value of a blackjack hand while accounting for aces.
 *
 * Converts aces from 11 to 1 when the hand value would otherwise exceed 21.
 *
 * @param {Array<Object>} hand - Array of card objects containing rank and value properties.
 * @returns {number} The calculated blackjack hand value.
 */
function calculate(hand) {
    let total = hand.reduce((sum, c) => sum + c.value, 0);
    let aces = hand.filter(c => c.rank === ':regional_indicator_a:').length;

    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }

    return total;
}

/**
 * Builds and shuffles a standard deck of cards.
 *
 * Creates card objects using the available suits and ranks, then randomizes
 * the deck order before returning it.
 *
 * @returns {Array<Object>} Shuffled array of card objects.
 */
function buildDeck() {
    const deck = [];
    for (const suit of suits) {
        for (const r of ranks) {
            deck.push({ emoji: `${r.rank}`, rank: r.rank,value: r.value });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

/**
 * Creates a blackjack game embed displaying dealer and player hand information.
 *
 * Shows the dealer's visible cards, player hands, current hand status,
 * scores, and highlights the active player hand.
 *
 * @param {import('discord.js').Interaction} interaction - The Discord interaction used to build the embed author.
 * @param {Array<Object>} dealerHand - Array of dealer card objects.
 * @param {Array<Array<Object>>} playerHands - Array containing each player's hand.
 * @param {number} handIndex - Index of the currently active player hand.
 * @param {number} bet - The player's wager amount.
 * @returns {import('discord.js').EmbedBuilder} The configured blackjack game embed.
 */
function createGameEmbed(interaction, dealerHand, playerHands, handIndex, bet) {
    let dealerString = '';
    if (handIndex === -1) {
        const score = calculate(dealerHand);
        dealerString = dealerHand.map(c => c.emoji).join(' + ') + ` = **${score}** ${score > 21 ? ' (BUST)' : ''}`;
    } else {
        dealerString = `${dealerHand[0].emoji} + :question: = **${calculate(dealerHand)}**`;
    }

    const embed = new EmbedBuilder()
        .setAuthor(buildAuthor(interaction))
        .addFields({ name: 'Dealer', value: dealerString, inline: false })
        .setColor(Colors.YELLOW)
        .setTimestamp()
        .setFooter({ text: 'Gamble Bot' });

    playerHands.forEach((h, i) => {
        const score = calculate(h);
        const isActive = i === handIndex;
        embed.addFields({
            name: `${isActive ? ':fire:' : ':bust_in_silhouette:'} Hand ${i + 1}`, 
            value: `${h.map(c => c.emoji).join(' + ')} = **${score}** ${score > 21 ? ' (BUST)' : ''}`,
            inline: true
        });
    });

    return embed;
}

/**
 * Creates the blackjack action button row for player controls.
 *
 * Includes hit, stand, double, and split actions with appropriate
 * disabled states based on the player's balance and hand conditions.
 *
 * @param {number} balance - The player's current balance.
 * @param {number} betAmount - The current bet amount.
 * @param {boolean} allowSplit - Whether the current hand can be split.
 * @returns {import('discord.js').ActionRowBuilder} Action row containing blackjack controls.
 */
function getRow(balance, betAmount, allowSplit) {
    const enoughMoney = betAmount * 2 <= balance;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('hit')
            .setEmoji('👆')
            .setLabel('Hit')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('stand')
            .setEmoji('✋')
            .setLabel('Stand')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('double')
            .setEmoji('💵')
            .setLabel('Double')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!enoughMoney),

        new ButtonBuilder()
            .setCustomId('split')
            .setEmoji('↔️')
            .setLabel('Split')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!(allowSplit && enoughMoney))
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('Play a round of blackjack.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(100)
            .setMaxValue(1000)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    async execute(interaction) {
        const betAmount = interaction.options.getNumber('stake');
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);

            // Check if the user has enough money
            if (profile.balance < betAmount) {
                return await interaction.reply({ 
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Build a deck and setup the hands
            const deck = buildDeck();
            let playerHands = [[deck.pop(), deck.pop()]];
            let dealerHand = [deck.pop()];
            let handIndex = 0;
            let doubledHands = [];

            // Send the initial embed
            await interaction.reply({
                embeds: [createGameEmbed(interaction, dealerHand, playerHands, handIndex, betAmount)],
                components: [getRow(profile.balance, betAmount, playerHands[handIndex][0].value === playerHands[handIndex][1].value)]
            });
            const response = await interaction.fetchReply();

            // Start a collector
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            // Callback for the buttons
            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({
                        embeds: [createIlligalInteractionEmbed()],
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Check if the user has enough money
                if (profile.balance < betAmount) {
                    collector.stop('silent');
                    return await interaction.reply({ 
                        embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                // Handle the option picked
                if (i.customId === 'hit') {
                    playerHands[handIndex].push(deck.pop());
                    if (calculate(playerHands[handIndex]) >= 21) handIndex++;
                } else if (i.customId === 'stand') {
                    handIndex++;
                } else if (i.customId === 'double') {
                    playerHands[handIndex].push(deck.pop());
                    doubledHands.push(handIndex);
                    handIndex++;
                } else if (i.customId === 'split') {
                    const card = playerHands[handIndex].pop();
                    playerHands[handIndex].push(deck.pop());
                    playerHands.push([card, deck.pop()]);
                }

                // Played all hands
                if (handIndex >= playerHands.length) {
                    dealerHand.push(deck.pop());
                    await i.update({
                        embeds: [createGameEmbed(interaction, dealerHand, playerHands, -1, betAmount)],
                        components: []
                    });

                    // Play the dealers hand
                    while (calculate(dealerHand) < 17) {
                        await wait(1500);

                        dealerHand.push(deck.pop());
                        await i.editReply({ embeds: [createGameEmbed(interaction, dealerHand, playerHands, -1, betAmount)] });
                    }
                    
                    await wait(1500);
                    collector.stop('finished');
                } else {
                    await i.update({
                        embeds: [createGameEmbed(interaction, dealerHand, playerHands, handIndex, betAmount)],
                        components: [getRow(profile.balance, betAmount, playerHands[handIndex][0].value === playerHands[handIndex][1].value)]
                    });
                }
            });

            // Handle timeout or game endings
            collector.on('end', async (_, reason) => {
                if (reason === 'time') {
                    return interaction.editReply({ embeds: [createTimedOutEmbed(interaction)], components: [] });
                } else if (reason === 'silent') {
                    return;
                }

                // Calculate the dealers score
                const dScore = calculate(dealerHand);
                let totalProfit = 0;
                let totalWagered = 0;

                // Calculate the players total profit and wager
                playerHands.forEach((h, index) => {
                    const pScore  = calculate(h);
                    const isDouble = doubledHands.includes(index);
                    const wager = isDouble ? betAmount * 2 : betAmount;

                    totalWagered += wager;

                    if (pScore > 21) {
                        totalProfit -= wager;
                    } else if (pScore > dScore || dScore > 21) {
                        totalProfit += wager;
                    } else if (pScore == dScore) {
                        // Push
                    } else {
                        totalProfit -= wager;
                    }
                });

                // Check if the user has enough money
                const profile = await db.ensureUser(userId);
                if (profile.balance < betAmount) {
                    return await interaction.reply({ 
                        embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                // Update the database
                const updatedProfile = await db.recordGamePlay(userId, totalWagered, totalWagered + totalProfit);
                const stats = await db.getBlackjackStats(userId);
                const isNatural = (playerHands.length === 1 && calculate(playerHands[0]) === 21 && playerHands[0].length === 2);
                await db.updateBlackjackStats(userId, isNatural, totalProfit > 0, totalProfit > 0 ? stats.current_win_streak + 1 : 0);

                // Build the embed showing the results
                const resultEmbed = new EmbedBuilder()
                    .setAuthor(buildAuthor(interaction))
                    .setTitle(dScore > 21 ? ':boom: Dealer Busted!' : ':black_joker: Round Complete!')
                    .setDescription(`Dealer: **${dScore}**`)
                    .setFields(
                        { name: 'Stake', value: formatBalance(betAmount), inline: true },
                        { name: 'Wagered', value: formatBalance(totalWagered), inline: true },
                        { name: 'Profit', value: formatBalance(totalProfit), inline: true },
                        { name: 'Streak', value: `:fire: ${totalProfit > 0 ? stats.current_win_streak + 1 : 0}`, inline: true },
                        { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: true },
                    )
                    .setColor(totalProfit > 0 ? Colors.GREEN : Colors.RED)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });

                await interaction.editReply({ embeds: [resultEmbed], components: [] });
            });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
};