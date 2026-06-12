const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType} = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createTimedOutEmbed } = require('../utils/standard_embeds.js');

/**
 * Calculates the current game multiplier based on the number of correct guesses.
 *
 * @param {number} correctGuesses - The number of consecutive correct guesses.
 * @returns {number} The calculated multiplier value rounded to two decimals.
 */
function getMultiplier(correctGuesses) {
    return Number((1.2 ** correctGuesses - 0.5).toFixed(2));
}

/**
 * Creates an embed message displaying the current High/Low game state.
 *
 * Includes the current number, guess streak, current profit, multiplier,
 * and the potential multiplier for the next correct guess.
 *
 * @param {import('discord.js').Interaction} interaction - The Discord interaction used to build the embed author.
 * @param {number} currentNumber - The current number shown to the player.
 * @param {number} correctGuesses - The number of consecutive correct guesses.
 * @param {number} betAmount - The amount wagered by the player.
 * @returns {import('discord.js').EmbedBuilder} The configured game status embed.
 */
function createGameEmbed(interaction, currentNumber, correctGuesses, betAmount) {
    return new EmbedBuilder()
        .setAuthor(buildAuthor(interaction))
        .setDescription('Will the next number be higher or lower than the current one?\n-# The number can only be between 0-100')
        .setFields(
            { name: 'Number', value: `**${currentNumber.toFixed(2)}**`, inline: true },
            { name: 'Streak', value: `:fire: ${correctGuesses}`, inline: true },
            { name: 'Profit', value: formatBalance(getMultiplier(correctGuesses) * betAmount - betAmount), inline: true },
            { name: 'Multiplier', value: `${getMultiplier(correctGuesses).toFixed(2)}x`, inline: true },
            { name: 'Next Mult', value: `${getMultiplier(correctGuesses + 1).toFixed(2)}x`, inline: true },
            { name: '\u200B', value: '\u200B', inline: true }
        )
        .setColor(Colors.YELLOW)
        .setTimestamp()
        .setFooter({ text: 'Gamble Bot' });
}

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('highlow')
        .setDescription('Keep guessing the correct outcome to get a higher multiplier, cash out when done.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(50)
            .setMaxValue(1000)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
        
    // Callback for when the command is executed
    async execute(interaction) {
        const betAmount = interaction.options.getNumber('stake');
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);

            let correctGuesses = 0;
            let currentNumber = Math.random() * 100;

            // Ensure the user has enough money
            if (profile.balance < betAmount) {
                return await interaction.reply({
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Build the action row containing buttons
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cashout')
                    .setEmoji('💰')
                    .setLabel('Cashout')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('higher')
                    .setEmoji('⬆️')
                    .setLabel('Higher')
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId('lower')
                    .setEmoji('⬇️')
                    .setLabel('Lower')
                    .setStyle(ButtonStyle.Primary)
            );

            // Send the game embed
            await interaction.reply({
                embeds: [createGameEmbed(interaction, currentNumber, correctGuesses, betAmount)],
                components: [row]
            });
            const response = await interaction.fetchReply();

            // Start an event collector for the buttons
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            // Callback for when a button is pressed
            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });
                }

                // Check if the user has enough money
                if (profile.balance < betAmount) {
                    collector.stop('silent');
                    return await interaction.reply({ 
                        embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                // Calculate a new number
                const oldNumber = currentNumber;
                currentNumber = Math.random() * 100;
                const isHigher = currentNumber > oldNumber;
                let busted = false;

                // Handle the button the user pressed
                if (i.customId === 'cashout') {
                    return collector.stop('cashout');
                } else if (i.customId === 'higher') {
                    if (!isHigher) busted = true;
                    else correctGuesses++;
                } else if (i.customId === 'lower') {
                    if (isHigher) busted = true;
                    else correctGuesses++;
                }

                // Handle the action consequence
                if (!busted) {
                    await i.update({
                        embeds: [createGameEmbed(interaction, currentNumber, correctGuesses, betAmount)],
                        components: [row],
                    });
                } else {
                    collector.stop('busted');
                }
            });

            // Callback for when the collector times out or the collector is ended
            collector.on('end', async (_, reason) => {
                if (reason === 'time') {                
                    return interaction.editReply({ embeds: [createTimedOutEmbed(interaction)], components: [] });
                } else if (reason === 'silent') {
                    return;
                }

                // Update the database and calculate the net
                const reward = reason === 'busted' ? 0 : betAmount * getMultiplier(correctGuesses);
                const updatedProfile = await db.recordGamePlay(userId, betAmount, reward);
                await db.setHighlowStats(userId, correctGuesses);
                const net = reward - betAmount;

                // Build the embed to show the game results
                const resultEmbed = new EmbedBuilder()
                    .setAuthor(buildAuthor(interaction))
                    .setTitle(reason === 'busted' ? ':boom: Busted!' : ':credit_card: You Cashed Out!')
                    .setDescription(reason === 'busted' ? 'You gussed wrong and lost your bet.' : (net > 0 ? 'You earned a profit.' : "You didn't earn a profit."))
                    .setFields(
                        { name: 'Stake', value: formatBalance(betAmount), inline: true },
                        { name: 'Streak', value: `:fire: ${correctGuesses}`, inline: true },
                        { name: 'Multiplier', value: `${getMultiplier(correctGuesses).toFixed(2)}x`, inline: true },
                        { name: 'New Balance', value: `:moneybag: ${formatBalance(updatedProfile.balance)}`, inline: true },
                        { name: 'Profit', value: formatBalance(net), inline: true }
                    )
                    .setColor(net > 0 ? Colors.GREEN : Colors.RED)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });

                await interaction.editReply({ embeds: [resultEmbed], components: [] });
            });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}