const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lottery')
        .setDescription('Start a lottery pool that other people can join. Random winner wins the pool.')
        .addNumberOption((option) => option
            .setName('ticket_price')
            .setDescription('The price per lottery ticket.')
            .setRequired(true)
            .setMinValue(500)
            .setMaxValue(5000)
        )
        .addNumberOption((option) => option
            .setName('intermission_duration')
            .setDescription('Amount of seconds to wait before drawing the winner.')
            .setRequired(true)
            .setMinValue(10)
            .setMaxValue(300)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),

    async execute(interaction) {
        const db = interaction.client.db;
        const ticketPrice = Math.floor(interaction.options.getNumber('ticket_price'));
        const intermission = Math.floor(interaction.options.getNumber('intermission_duration'));

        // participants: Map userId -> { userTag }
        const participants = new Map();

        try {
            // Ensure starter has money and auto-join them
            const starter = await db.ensureUser(interaction.user.id);
            if (starter.balance < ticketPrice) {
                return await interaction.reply({ embeds: [await createInsufficientMoneyEmbed(interaction, ticketPrice)], flags: MessageFlags.Ephemeral });
            }

            participants.set(interaction.user.id, { userTag: interaction.user.tag });

            const startUnix = Math.floor(Date.now() / 1000) + intermission;

            // Helper to build the participants field
            const buildParticipantsField = () => {
                const list = Array.from(participants.keys()).map(id => `> <@${id}>`).join('\n');
                return { name: 'Participants', value: `${participants.size} currently joined\n\n${list || '> *no participants*'}`, inline: false };
            };

            // Build the initial embed showing ticket price and count down
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':tickets: Lottery')
                .setDescription(`Drawing a winner <t:${startUnix}:R>`)
                .addFields(
                    { name: 'Ticket Price', value: formatBalance(ticketPrice), inline: true },
                    buildParticipantsField()
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            // Build the button row
            const joinBtn = new ButtonBuilder().setCustomId('lottery_join').setLabel('Join Lottery').setStyle(ButtonStyle.Success);
            const leaveBtn = new ButtonBuilder().setCustomId('lottery_leave').setLabel('Leave Lottery').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(joinBtn, leaveBtn);

            await interaction.reply({ embeds: [embed], components: [row] });
            const mainMsg = await interaction.fetchReply();

            const collector = mainMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: intermission * 1000 });

            // Helper to refresh the main embeds contents
            const refreshMain = async () => {
                embed.setDescription(`Drawing a winner <t:${startUnix}:R>`);
                embed.setFields({ name: 'Ticket Price', value: formatBalance(ticketPrice), inline: true }, buildParticipantsField());
                await interaction.editReply({ embeds: [embed] });
            };
            
            // Listen for when users join/leave
            collector.on('collect', async (i) => {
                try {
                    // User tries to join lottery
                    if (i.customId === 'lottery_join') {
                        if (participants.has(i.user.id)) {
                            const embed = new EmbedBuilder()
                                .setDescription(':x: You are already in this lottery!')
                                .setColor(Colors.RED)
                                .setTimestamp()
                                .setFooter({ text: 'Gamble Bot' });

                            return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        // Check if the user has enough money
                        const profile = await db.getUser(i.user.id);
                        if (!profile || profile.balance < ticketPrice) {
                            return i.reply({ embeds: [await createInsufficientMoneyEmbed(i, ticketPrice)], flags: MessageFlags.Ephemeral });
                        }

                        // Add the user to the participants list
                        participants.set(i.user.id, { userTag: i.user.tag });

                        // Build the success feedback embed
                        const embed = new EmbedBuilder()
                            .setDescription(`:tickets: You joined the lottery for **${formatBalance(ticketPrice)}**!`)
                            .setColor(Colors.GREEN)
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });

                        await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                        await refreshMain();
                    }

                    // User tries to leave
                    if (i.customId === 'lottery_leave') {
                        // Check if they are in the lottery
                        if (!participants.has(i.user.id)) {
                            const embed = new EmbedBuilder()
                                .setDescription(':x: You are not in the lottery.')
                                .setColor(Colors.RED)
                                .setTimestamp()
                                .setFooter({ text: 'Gamble Bot' })
                            return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        // Confirm leave buttons
                        const confirm = new ButtonBuilder()
                            .setCustomId('lottery_leave_confirm')
                            .setLabel('Confirm Leave')
                            .setStyle(ButtonStyle.Danger);
                        
                        const cancel = new ButtonBuilder()
                            .setCustomId('lottery_leave_cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        // Build the confirm leave embed
                        const embed = new EmbedBuilder()
                            .setDescription('Are you sure you want to leave the lottery?')
                            .setColor(Colors.YELLOW)
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });

                        await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(confirm, cancel)], flags: MessageFlags.Ephemeral });
                        const leaveMsg = await i.fetchReply();

                        const leaveCollector = leaveMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

                        // Called when the user confirms if they want to leave
                        leaveCollector.on('collect', async (btn) => {
                            if (btn.user.id !== i.user.id) return btn.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });

                            if (btn.customId === 'lottery_leave_confirm') {
                                participants.delete(i.user.id);
                                
                                const embed = new EmbedBuilder()
                                    .setDescription(':white_check_mark: You left the lottery.')
                                    .setColor(Colors.GREEN)
                                    .setTimestamp()
                                    .setFooter({ text: 'Gamble Bot' });

                                await btn.update({ embeds: [embed], components: [] });
                                await refreshMain();
                                leaveCollector.stop('left');
                            } else {
                                const embed = new EmbedBuilder()
                                    .setDescription(':information_source: Leave cancelled.')
                                    .setColor(Colors.YELLOW)
                                    .setTimestamp()
                                    .setFooter({ text: 'Gamble Bot' });

                                await btn.update({ embeds: [embed], components: [] });
                                leaveCollector.stop('cancelled');
                            }
                        });
                    }
                } catch (err) {
                    handleInteractionError(i, err);
                }
            });

            // Called when the lottery draw starts
            collector.on('end', async () => {
                await interaction.editReply({ components: [] });

                // Cancel lottery if theres no participants
                if (participants.size <= 1) {
                    const noEmbed = new EmbedBuilder()
                        .setTitle(':x: Too few participants')
                        .setDescription('The lottery ended with too few participants.')
                        .setColor(Colors.RED)
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    return await interaction.editReply({ embeds: [noEmbed] });
                }

                // Draw a winner
                const entries = Array.from(participants.keys());
                const winnerId = entries[Math.floor(Math.random() * entries.length)];
                const pool = ticketPrice * participants.size;

                let winner = {};
                const results = [];

                for (const userId of entries) {
                    const p = participants.get(userId);
                    const profile = await db.getUser(userId);

                    // Check if the user has enough money, if not, treat as no-show
                    if (!profile || profile.balance < ticketPrice) {
                        results.push({ userId, userTag: p.userTag, stake: ticketPrice, profit: 0, newBalance: profile ? profile.balance : 0, winner: false });
                        continue;
                    }

                    // Winner gets the pool
                    if (userId === winnerId) {
                        const updated = await db.recordGamePlay(userId, ticketPrice, pool);
                        const profit = (pool - ticketPrice);

                        winner = { userTag: p.userTag, stake: ticketPrice, profit, newBalance: updated.balance };
                        results.push({ userId, userTag: p.userTag, stake: ticketPrice, profit, newBalance: updated.balance, winner: true });
                    } else {
                        const updated = await db.recordGamePlay(userId, ticketPrice, 0);
                        const profit = -ticketPrice;
                        results.push({ userId, userTag: p.userTag, stake: ticketPrice, profit, newBalance: updated.balance, winner: false });
                    }
                }

                // Build the result embed
                const resultEmbed = new EmbedBuilder()
                    .setTitle(':tada: Lottery Draw')
                    .setDescription(`Winner: <@${winnerId}>`)
                    .setFields({ name: 'Payout', value: `:moneybag: **${formatBalance(pool)}**`, inline: true })
                    .setColor(Colors.GREEN)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });

                await interaction.editReply({ embeds: [resultEmbed] });

                // Notify participants via DM
                for (const r of results) {
                    try {
                        const user = await interaction.client.users.fetch(r.userId);
                        const dm = new EmbedBuilder()
                            .setTitle(':tickets: Lottery Result')
                            .setDescription(`The lottery has been drawn. Winner: <@${winnerId}>`)
                            .addFields(
                                { name: 'Stake', value: formatBalance(r.stake), inline: true },
                                { name: 'Profit', value: formatBalance(r.profit, true), inline: true },
                                { name: 'New Balance', value: `:moneybag: **${formatBalance(r.newBalance)}**`, inline: false }
                            )
                            .setColor(r.winner ? Colors.GREEN : Colors.RED)
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });

                        await user.send({ embeds: [dm], flags: MessageFlags.Ephemeral });
                    } catch {
                        // ignore
                    }
                }
            });
        } catch (err) {
            handleInteractionError(interaction, err);
        }
    }
};
