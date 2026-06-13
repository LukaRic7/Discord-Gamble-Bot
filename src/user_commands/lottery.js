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
            .setMinValue(100)
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

            const buildParticipantsField = () => {
                const list = Array.from(participants.keys()).map(id => `> <@${id}>`).join('\n');
                return { name: 'Participants', value: `${participants.size} currently joined\n\n${list || '> *no participants*'}`, inline: false };
            };

            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':tickets: Lottery')
                .setDescription(`Drawing in <t:${startUnix}:R> (${ticketPrice} per ticket)`)
                .addFields(
                    { name: 'Ticket Price', value: formatBalance(ticketPrice), inline: true },
                    buildParticipantsField()
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            const joinBtn = new ButtonBuilder().setCustomId('lottery_join').setLabel('Join Lottery').setStyle(ButtonStyle.Success);
            const leaveBtn = new ButtonBuilder().setCustomId('lottery_leave').setLabel('Leave Lottery').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(joinBtn, leaveBtn);

            await interaction.reply({ embeds: [embed], components: [row] });
            const mainMsg = await interaction.fetchReply();

            const collector = mainMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: intermission * 1000 });

            const refreshMain = async () => {
                embed.setDescription(`Drawing in <t:${startUnix}:R> (${ticketPrice} per ticket)`);
                embed.spliceFields(0, embed.data.fields.length);
                embed.addFields({ name: 'Ticket Price', value: formatBalance(ticketPrice), inline: true }, buildParticipantsField());
                await interaction.editReply({ embeds: [embed] });
            };

            collector.on('collect', async (i) => {
                try {
                    if (i.customId === 'lottery_join') {
                        if (participants.has(i.user.id)) {
                            return i.reply({ content: 'You are already in the lottery.', flags: MessageFlags.Ephemeral });
                        }

                        const profile = await db.getUser(i.user.id);
                        if (!profile || profile.balance < ticketPrice) {
                            return i.reply({ embeds: [await createInsufficientMoneyEmbed(i, ticketPrice)], flags: MessageFlags.Ephemeral });
                        }

                        participants.set(i.user.id, { userTag: i.user.tag });
                        await i.reply({ content: `You joined the lottery for ${formatBalance(ticketPrice)}.`, flags: MessageFlags.Ephemeral });
                        await refreshMain();
                    }

                    if (i.customId === 'lottery_leave') {
                        if (!participants.has(i.user.id)) {
                            return i.reply({ embeds: [new EmbedBuilder().setDescription(':information_source: You are not in the lottery.').setColor(Colors.YELLOW).setTimestamp().setFooter({ text: 'Gamble Bot' })], flags: MessageFlags.Ephemeral });
                        }

                        // confirm leave
                        const confirm = new ButtonBuilder().setCustomId('lottery_leave_confirm').setLabel('Confirm Leave').setStyle(ButtonStyle.Danger);
                        const cancel = new ButtonBuilder().setCustomId('lottery_leave_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
                        await i.reply({ embeds: [new EmbedBuilder().setDescription('Are you sure you want to leave the lottery?').setColor(Colors.YELLOW).setTimestamp().setFooter({ text: 'Gamble Bot' })], components: [new ActionRowBuilder().addComponents(confirm, cancel)], flags: MessageFlags.Ephemeral });
                        const leaveMsg = await i.fetchReply();

                        const leaveCollector = leaveMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });

                        leaveCollector.on('collect', async (btn) => {
                            if (btn.user.id !== i.user.id) return btn.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });

                            if (btn.customId === 'lottery_leave_confirm') {
                                participants.delete(i.user.id);
                                await btn.update({ embeds: [new EmbedBuilder().setDescription(':white_check_mark: You left the lottery.').setColor(Colors.GREEN).setTimestamp().setFooter({ text: 'Gamble Bot' })], components: [] });
                                await refreshMain();
                                leaveCollector.stop('left');
                            } else {
                                await btn.update({ embeds: [new EmbedBuilder().setDescription(':information_source: Leave cancelled.').setColor(Colors.YELLOW).setTimestamp().setFooter({ text: 'Gamble Bot' })], components: [] });
                                leaveCollector.stop('cancelled');
                            }
                        });
                    }
                } catch (err) {
                    handleInteractionError(i, err);
                }
            });

            collector.on('end', async () => {
                // remove buttons
                await interaction.editReply({ components: [] });

                if (participants.size === 0) {
                    const noEmbed = new EmbedBuilder()
                        .setTitle(':x: No participants')
                        .setDescription('The lottery ended with no participants.')
                        .setColor(Colors.RED)
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    return await interaction.editReply({ embeds: [noEmbed] });
                }

                // draw winner
                const entries = Array.from(participants.keys());
                const winnerId = entries[Math.floor(Math.random() * entries.length)];
                const pool = ticketPrice * participants.size;

                const winners = [];
                const losers = [];
                const results = [];

                for (const userId of entries) {
                    const p = participants.get(userId);
                    const profile = await db.getUser(userId);
                    if (!profile || profile.balance < ticketPrice) {
                        // treat as no-show
                        losers.push({ userTag: p.userTag, stake: ticketPrice, note: 'Insufficient funds at draw' });
                        results.push({ userId, userTag: p.userTag, stake: ticketPrice, profit: 0, newBalance: profile ? profile.balance : 0, winner: false });
                        continue;
                    }

                    if (userId === winnerId) {
                        // winner gets the pool
                        const updated = await db.recordGamePlay(userId, ticketPrice, pool);
                        const profit = (pool - ticketPrice);
                        winners.push({ userTag: p.userTag, stake: ticketPrice, profit, newBalance: updated.balance });
                        results.push({ userId, userTag: p.userTag, stake: ticketPrice, profit, newBalance: updated.balance, winner: true });
                    } else {
                        const updated = await db.recordGamePlay(userId, ticketPrice, 0);
                        const profit = -ticketPrice;
                        losers.push({ userTag: p.userTag, stake: ticketPrice, profit, newBalance: updated.balance });
                        results.push({ userId, userTag: p.userTag, stake: ticketPrice, profit, newBalance: updated.balance, winner: false });
                    }
                }

                const resultEmbed = new EmbedBuilder()
                    .setTitle(':tada: Lottery Draw')
                    .setDescription(`Winner: <@${winnerId}> — Payout: ${formatBalance(pool)}`)
                    .setColor(Colors.GREEN)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });

                const winnerField = winners.length ? { name: 'Winners', value: winners.map(w => `> ${w.userTag} — Stake ${formatBalance(w.stake)} — Profit ${formatBalance(w.profit, true)} — New Balance ${formatBalance(w.newBalance)}`).join('\n') } : { name: 'Winners', value: '*No winners*' };
                const loserField = losers.length ? { name: 'Losers', value: losers.map(l => `> ${l.userTag} — Stake ${formatBalance(l.stake)} — Profit ${formatBalance(l.profit, true)} — New Balance ${formatBalance(l.newBalance)}`).join('\n') } : { name: 'Losers', value: '*No losers*' };

                resultEmbed.addFields(winnerField, loserField);
                await interaction.editReply({ embeds: [resultEmbed] });

                // Notify participants via DM
                for (const r of results) {
                    try {
                        const user = await interaction.client.users.fetch(r.userId);
                        const dm = new EmbedBuilder()
                            .setTitle(':lottery: Lottery Result')
                            .setDescription(`The lottery has been drawn. Winner: <@${winnerId}>`)
                            .addFields(
                                { name: 'Stake', value: formatBalance(r.stake), inline: true },
                                { name: 'Won', value: r.winner ? 'Yes' : 'No', inline: true },
                                { name: 'Profit', value: formatBalance(r.profit, true), inline: true },
                                { name: 'New Balance', value: formatBalance(r.newBalance), inline: true }
                            )
                            .setColor(r.winner ? Colors.GREEN : Colors.RED)
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });

                        await user.send({ embeds: [dm] });
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
