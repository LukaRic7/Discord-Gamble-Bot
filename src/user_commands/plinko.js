const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

const MULTIPLIERS = [6.0, 2.0, 0.7, 0.3, 0.7, 2.0, 6.0];
const ROW_COUNT = 7;

/**
 * Builds a visual ASCII representation of a Plinko game board.
 *
 * This function renders:
 * - A pyramid of pegs with an optional falling ball position
 * - A row of multiplier buckets at the bottom
 * - A final "drop slot" row showing where the ball lands when the game ends
 *
 * When `gameOver` is false, the ball is rendered at its current position
 * inside the pyramid. When `gameOver` is true, the ball is only shown in
 * the final bucket row instead.
 *
 * @param {number} currentRow - The current row index of the falling ball.
 * @param {number} currentPosition - The horizontal position of the ball in the current row / final bucket index.
 * @param {boolean} [gameOver=false] - Whether the simulation has finished and the ball has landed.
 * @returns {string} A multi-line string representing the full Plinko board state.
 */
function buildPlinkoCodeBlock(currentRow, currentPosition, gameOver = false) {
    let rows = [];

    // Build the rows of the pyramid
    for (let i = 0; i < ROW_COUNT; i++) {
        let padding = ' '.repeat(21 - i * 3);
        let pegs = [];

        for (let j = 0; j <= i; j++) {
            // Render the ball if it's on the current row/pos, otherwise render a peg
            if (!gameOver && i === currentRow && j === currentPosition) {
                pegs.push('●');
            } else {
                pegs.push('·');
            }
        }
        rows.push(padding + pegs.join('     '));
    }

    // Format the Multiplier Buckets
    const multStrings = MULTIPLIERS.map(m => {
        return ` ${m.toFixed(1)} `;
    });
    
    rows.push(`|${multStrings.join('|')}|`);

    // Drop the ball into the specific bucket when the game ends
    const ballRow = MULTIPLIERS.map((_, i) => {
        return i === currentPosition && gameOver ? '\\ ● /' : '\\   /';
    });
    // 1 space prefix aligns the drop slots perfectly with the '|' dividers
    rows.push(' ' + ballRow.join(' '));

    return rows.join('\n');
}

module.exports = { // RTP = 98.44%
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('plinko')
        .setDescription('Play a game of plinko.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(200)
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
            let profile = await db.ensureUser(userId);

            if (profile.balance < betAmount) {
                return await interaction.reply({
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)],
                    flags: MessageFlags.Ephemeral
                });
            }

            // The ball always starts at the very top peg
            let pos = 0;

            const infoStr = 'The ball starts at the top and drops down, hitting pins along the way.'
                + ' The numbers at the bottom represent the multiplier of your stake at payout.'

            // Build the initial embed for showing the plinko table
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(`${infoStr}\n\`\`\`\n${buildPlinkoCodeBlock(0, pos, false)}\n\`\`\``)
                .setFields(
                    { name: 'Stake', value: formatBalance(betAmount), inline: true }
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [embed] });
            await wait(1500);

            // Animate the drops row by row
            for (let row = 1; row <= ROW_COUNT; row++) {
                // Ball falls left (+0) or right (+1)
                if (row < ROW_COUNT) {
                    pos += Math.random() < 0.5 ? 0 : 1;
                }
                
                const isGameOver = (row === ROW_COUNT);
                
                embed.setDescription(`${infoStr}\n\`\`\`\n${buildPlinkoCodeBlock(row, pos, isGameOver)}\n\`\`\``);
                await interaction.editReply({ embeds: [embed] });

                if (!isGameOver) await wait(1500);
            }

            // Check if the user has enough money
            profile = await db.ensureUser(userId);
            if (profile.balance < betAmount) {
                return await interaction.editReply({ 
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Handle the payout outcome
            const finalMultiplier = MULTIPLIERS[pos];
            const payout = betAmount * finalMultiplier;
            const profit = payout - betAmount;
            
            // Update the database
            const updatedProfile = await db.recordGamePlay(userId, betAmount, payout);
            const hitEdge = pos === 0 || pos === MULTIPLIERS.length - 1;
            if (hitEdge) {
                await db.setPlinkoStats(userId, 1); // Hit edge
            }

            embed.setTitle(hitEdge ? ':small_red_triangle: You Hit An Edge!' : (profit > 0 ? ':chart_with_upwards_trend: You Turned a Profit!' : ":chart_with_downwards_trend: Better Luck Next Time."))
                .setFields(
                    { name: 'Stake', value: formatBalance(betAmount), inline: true },
                    { name: 'Profit', value: formatBalance(profit, true), inline: true },
                    { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: true }
                )
                .setColor(profit > 0 ? Colors.GREEN : Colors.RED);
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}