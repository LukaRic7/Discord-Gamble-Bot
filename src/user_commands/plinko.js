const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

// 6 rows means 7 possible landing buckets at the bottom.
const MULTIPLIERS = [5.0, 2.0, 0.5, 0.2, 0.5, 2.0, 5.0];
const ROW_COUNT = 7;

function buildPlinkoCodeBlock(currentRow, currentPosition, gameOver = false) {
    let rows = [];

    // 1. Build the 6 rows of the pyramid
    for (let i = 0; i < ROW_COUNT; i++) {
        // 24 spaces perfectly centers the top peg relative to the 7 buckets below
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

    // 2. Format the Multiplier Buckets (Centered to exactly 6 characters each)
    const multStrings = MULTIPLIERS.map(m => {
        return ` ${m.toFixed(1)} `;
    });
    
    rows.push(`|${multStrings.join('|')}|`);

    // 3. Drop the ball into the specific bucket when the game ends
    if (gameOver) {
        const ballRow = MULTIPLIERS.map((_, i) => {
            return i === currentPosition ? '\\ ● /' : '\\   /';
        });
        // 1 space prefix aligns the drop slots perfectly with the '|' dividers
        rows.push(' ' + ballRow.join(' '));
    }

    return rows.join('\n');
}

module.exports = {
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
    
    async execute(interaction) {
        const betAmount = interaction.options.getNumber('stake');
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);

            if (profile.balance < betAmount) {
                return await interaction.reply({
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)],
                    flags: MessageFlags.Ephemeral
                });
            }

            // The ball always starts at the very top peg (Row 0, Index 0)
            let pos = 0;

            const infoStr = 'The ball starts at the top and drops down, hitting pins along the way.'
                + ' The numbers at the bottom represent the multiplier of your stake at payout.'

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
                pos += Math.random() < 0.5 ? 0 : 1;
                
                const isGameOver = (row === ROW_COUNT);
                
                embed.setDescription(`${infoStr}\n\`\`\`\n${buildPlinkoCodeBlock(row, pos, isGameOver)}\n\`\`\``);
                await interaction.editReply({ embeds: [embed] });

                if (!isGameOver) {
                    await wait(1500);
                }
            }

            // Handle the payout outcome
            const finalMultiplier = MULTIPLIERS[pos];
            const winnings = betAmount * finalMultiplier;
            const profit = winnings - betAmount;
            
            // Adjust to fit your exact database saving approach
            profile.balance += profit;
            if (typeof profile.save === 'function') await profile.save();
            else if (db.saveUser) await db.saveUser(profile);

            embed.addFields(
                { name: 'Multiplier', value: `${finalMultiplier}x`, inline: true },
                { name: 'Payout', value: formatBalance(winnings), inline: true }
            );
            
            // Turn embed Green for profit, Yellow for breaking even, Red for loss
            embed.setColor(profit > 0 ? Colors.GREEN : (profit === 0 ? Colors.YELLOW : Colors.RED));
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}