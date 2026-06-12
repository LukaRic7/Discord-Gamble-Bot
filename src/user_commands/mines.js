const { SlashCommandBuilder, InteractionContextType, IntegrationType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonStyle, ButtonBuilder, ComponentType } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createTimedOutEmbed } = require('../utils/standard_embeds.js');

/**
 * Calculates the maximum possible multiplier based on the selected mine count.
 *
 * @param {number} mines - The number of mines placed on the board.
 * @returns {number} The maximum multiplier value for the given mine count.
 */
function getMaxMultiplier(mines) {
    const minMines = 5;
    const maxMines = 14;

    const minMaxMultiplier = 6;
    const maxMaxMultiplier = 10;

    const t = (mines - minMines) / (maxMines - minMines);

    return minMaxMultiplier + t * (maxMaxMultiplier - minMaxMultiplier);
}

/**
 * Calculates the current game multiplier based on mines and diamonds found.
 *
 * @param {number} mines - The number of mines placed on the board.
 * @param {number} diamondsFound - The number of diamonds successfully revealed.
 * @returns {number} The current payout multiplier.
 */
function calculateMultiplier(mines, diamondsFound) {
    const startMultiplier = 0.5;
    const maxMultiplier = getMaxMultiplier(mines);
    const totalDiamonds = 15 - mines;

    const growth = (maxMultiplier - startMultiplier) / totalDiamonds;

    return startMultiplier + (diamondsFound * growth);
}

/**
 * Generates the interactive Mines game board using Discord button components.
 *
 * Creates a 3x5 grid of buttons, revealing mines and diamonds when appropriate,
 * and adds a cash-out button when the player can collect winnings.
 *
 * @param {Array<boolean>} board - Array representing mine locations on the board.
 * @param {Array<boolean>} revealed - Array tracking which positions have been revealed.
 * @param {boolean} gameOver - Whether the current game has ended.
 * @param {number} diamondsFound - Number of diamonds discovered by the player.
 * @param {number} targetDiamonds - Required diamonds needed to win the game.
 * @returns {Array<ActionRowBuilder>} Array of Discord action rows containing board buttons.
 */
function generateBoard(board, revealed, gameOver, diamondsFound, targetDiamonds) {
    const rows = [];
    
    for (let i = 0; i < 3; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
            const index = i * 5 + j;
            const isRevealed = revealed[index] || gameOver;
            const isMine = board[index];

            let emoji = '❓';
            let style = ButtonStyle.Secondary;

            if (isRevealed) {
                emoji = isMine ? '💣' : '💎';
                style = isMine ? ButtonStyle.Danger : (revealed[index] ? ButtonStyle.Success : ButtonStyle.Secondary);
            }

            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mine_${index}`)
                    .setEmoji(emoji)
                    .setStyle(style)
                    .setDisabled(isRevealed)
            );
        }
        rows.push(row);
    }

    // Cash Out Button Row
    if (!gameOver && diamondsFound > 0 && diamondsFound < targetDiamonds) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('cashout')
                .setEmoji('💵')
                .setLabel('Cash Out')
                .setStyle(ButtonStyle.Primary)
        ));
    }

    return rows;
}

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('mines')
        .setDescription('Uncover diamonds multiplying your stake, but discover a mine and lose the entire stake.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(500)
            .setMaxValue(3000)
        )
        .addNumberOption((option) => option
            .setName('num_mines')
            .setDescription('The number of mines, the more, the bigger the multiplier.')
            .setRequired(true)
            .setMinValue(5)
            .setMaxValue(14)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    // Callback for when the command is executed
    async execute(interaction) {
        const betAmount = interaction.options.getNumber('stake');
        const numMines = interaction.options.getNumber('num_mines');
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);

            // Ensure the user has enough money
            if (profile.balance < betAmount) {
                return await interaction.reply({
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Initialize Game State
            const board = Array(15).fill(false);
            const revealed = Array(15).fill(false);
            let placedMines = 0;
            let diamondsFound = 0;
            let currentMultiplier = 0.5;
            const targetDiamonds = 15 - numMines;

            // Randomly place mines
            while (placedMines < numMines) {
                const randIndex = Math.floor(Math.random() * 15);
                if (!board[randIndex]) {
                    board[randIndex] = true;
                    placedMines++;
                }
            }

            // Build Initial Embed
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription('Pick a field below to uncover.')
                .addFields(
                    { name: 'Stake', value: formatBalance(betAmount), inline: true },
                    { name: 'Mines', value: `:bomb: ${numMines}`, inline: true },
                    { name: 'Diamonds Left', value: `:gem: ${targetDiamonds}`, inline: true },
                    { name: 'Multiplier', value: '**0.5x**', inline: true },
                    { name: 'Next Mult', value: `${calculateMultiplier(numMines, diamondsFound + 1).toFixed(2)}x`, inline: true },
                    { name: 'Profit', value: `**${formatBalance(betAmount * 0.5 - betAmount, true)}**`, inline: true }
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            // Send the initial game board
            await interaction.reply({
                embeds: [embed],
                components: generateBoard(board, revealed, false, diamondsFound, targetDiamonds)
            });
            const response = await interaction.fetchReply();

            // Create a collector for the buttons
            const collector = response.createMessageComponentCollector({ 
                componentType: ComponentType.Button, 
                time: 300000
            });

            // Callback for button clicks
            collector.on('collect', async (i) => {
                // Ensure only the person who started the game can click
                if (i.user.id !== userId) {
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

                // Handle Cash Out
                if (i.customId === 'cashout') {
                    const payout = betAmount * currentMultiplier;
                    
                    const updatedProfile = await db.recordGamePlay(userId, betAmount, betAmount * currentMultiplier);
                    await db.setMinesStats(userId, 0, diamondsFound, 0);

                    embed.setColor(Colors.GREEN)
                        .setTitle(':credit_card: Cashed Out!')
                        .setDescription(`You walked away with your profit!`)
                        .setFields(
                            { name: 'Stake', value: formatBalance(betAmount), inline: true },
                            { name: 'Multiplier', value: `${currentMultiplier.toFixed(2)}x`, inline: true },
                            { name: 'Profit', value: formatBalance(payout - betAmount, true), inline: true },
                            { name: 'New Balance', value: `:moneybag: ${formatBalance(updatedProfile.balance)}`, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    const finalComponents = generateBoard(board, revealed, true, diamondsFound, targetDiamonds);
                    await i.update({ embeds: [embed], components: finalComponents });

                    return collector.stop();
                }

                // Handle Tile Clicks
                const clickedIndex = parseInt(i.customId.split('_')[1]);
                revealed[clickedIndex] = true;

                // Hit a Mine - Game Over
                if (board[clickedIndex]) {
                    const updatedProfile = await db.recordGamePlay(userId, betAmount, 0);
                    await db.setMinesStats(userId, 1, diamondsFound, 0);

                    embed.setColor(Colors.RED)
                        .setTitle(':boom: Boom!')
                        .setDescription(`You hit a mine and lost your stake.`)
                        .setFields(
                            { name: 'Stake', value: formatBalance(betAmount), inline: true },
                            { name: 'Profit', value: formatBalance(-betAmount), inline: true },
                            { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });
                    
                    const finalComponents = generateBoard(board, revealed, true, diamondsFound, targetDiamonds);
                    await i.update({ embeds: [embed], components: finalComponents });

                    return collector.stop();
                } else {
                    // Hit a Diamond - Update State
                    diamondsFound++;
                    currentMultiplier = calculateMultiplier(numMines, diamondsFound);
                    const currentValue = betAmount * currentMultiplier;
                    const diamondsLeft = targetDiamonds - diamondsFound;

                    // Max Win (Found all diamonds)
                    if (diamondsLeft === 0) {
                        const updatedProfile = await db.recordGamePlay(userId, betAmount, betAmount * currentMultiplier);
                        await db.setMinesStats(userId, 0, diamondsFound, 1);
                        
                        embed.setColor(Colors.GREEN)
                            .setTitle(':trophy: Perfect Game!')
                            .setDescription(`You cleared the board and won automatically!`)
                            .setFields(
                                { name: 'Stake', value: formatBalance(betAmount), inline: true },
                                { name: 'Multiplier', value: `${currentMultiplier.toFixed(2)}x`, inline: true },
                                { name: 'Profit', value: formatBalance(payout - betAmount, true), inline: true },
                                { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                            )
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });
                        
                        const finalComponents = generateBoard(board, revealed, true, diamondsFound, targetDiamonds);
                        await i.update({ embeds: [embed], components: finalComponents });
                        
                        return collector.stop();
                    }
                    
                    // Game continues
                    embed.setFields(
                        { name: 'Stake', value: formatBalance(betAmount), inline: true },
                        { name: 'Mines', value: `:bomb: ${numMines}`, inline: true },
                        { name: 'Diamonds Left', value: `:gem: ${diamondsLeft}`, inline: true },
                        { name: 'Multiplier', value: `**${currentMultiplier.toFixed(2)}x**`, inline: true },
                        { name: 'Next Mult', value: `${calculateMultiplier(numMines, diamondsFound + 1).toFixed(2)}x`, inline: true },
                        { name: 'Profit', value: formatBalance(currentValue - betAmount, true), inline: true }
                    );

                    const updatedComponents = generateBoard(board, revealed, false, diamondsFound, targetDiamonds);
                    await i.update({ embeds: [embed], components: updatedComponents });
                }
            });

            // Callback for collector ending or times out
            collector.on('end', async (_, reason) => {
                if (reason === 'silent') return;

                // If it ends due to timeout, cash them out or end game automatically
                if (reason === 'time') {
                    const finalComponents = generateBoard(board, revealed, true, diamondsFound, targetDiamonds);
                    await interaction.editReply({ embeds: [createTimedOutEmbed(interaction)], components: finalComponents }).catch(console.error);
                }
            });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}