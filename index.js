const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose'); // Banco de Dados
const ffmpeg = require('fluent-ffmpeg'); // Para Figurinhas Animadas

// --- CONFIGURAÇÃO DO MONGODB ---
// Substitua 'SEU_LINK_AQUI' pelo link do MongoDB Atlas que você copiou
const mongoURI = 'mongodb+srv://admin:teteu2025@cluster0.4wymucf.mongodb.net/?appName=Cluster0'; 

mongoose.connect(mongoURI)
    .then(() => console.log('✅ Conectado ao MongoDB Atlas!'))
    .catch((err) => console.error('❌ Erro no MongoDB:', err));

// Esquema para RPG e Economia (Onde a "memória" do bot vai morar)
const userSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    coins: { type: Number, default: 0 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    warns: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// --- CONFIGURAÇÃO DE ARQUIVOS LOCAIS ---
const dbPath = path.join(__dirname, 'database', 'advs.json');
const superUsersPath = path.join(__dirname, 'database', 'superusers.json');

fs.ensureDirSync(path.join(__dirname, 'database'));
if (!fs.existsSync(dbPath)) fs.writeJsonSync(dbPath, {});
if (!fs.existsSync(superUsersPath)) fs.writeJsonSync(superUsersPath, []);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ],
    }
});

let salaAtual = "Nenhuma sala definida";

// --- FUNÇÕES AUXILIARES ---
async function ejetarComImagem(chat, target) {
    try {
        const caminhoImagem = path.join(__dirname, 'ejetado.jpg');
        if (fs.existsSync(caminhoImagem)) {
            const media = MessageMedia.fromFilePath(caminhoImagem);
            await chat.sendMessage(media, { 
                caption: `🚫 @${target.split('@')[0]} foi ejetado da nave!`, 
                mentions: [target] 
            });
        } else {
            await chat.sendMessage(`🚫 @${target.split('@')[0]} ejetado!`, { mentions: [target] });
        }
        await chat.removeParticipants([target]);
    } catch (e) { console.log("Erro ao ejetar:", e); }
}

// --- EVENTOS DO CLIENTE ---
client.on('qr', qr => {
    console.log('ESCANEIE O QR CODE ABAIXO:');
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('✅ YukonBot Online na Square Cloud!');
});

client.on('message_create', async msg => {
    const chat = await msg.getChat();
    const body = msg.body || '';
    const command = body.split(' ')[0].toLowerCase();
    const args = body.split(' ').slice(1);
    
    // Identificação do Usuário
    const senderRaw = msg.author || msg.from || "";
    const senderNumber = senderRaw.replace(/\D/g, ''); 

    // Garantir que o usuário existe no Banco de Dados (RPG/Economia)
    // Isso cria o perfil dele automaticamente ao mandar qualquer mensagem
    if (chat.isGroup) {
        try {
            await User.findOneAndUpdate(
                { userId: senderRaw },
                { $setOnInsert: { userId: senderRaw } },
                { upsert: true }
            );
        } catch (e) { console.log("Erro ao salvar user no banco"); }
    }

    // Lógica de Admins
    const groupAdmins = chat.isGroup ? chat.participants
        .filter(p => p.isAdmin || p.isSuperAdmin)
        .map(p => p.id.user.replace(/\D/g, '')) : [];
    
    const savedSuperUsers = fs.readJsonSync(superUsersPath);
    const fixedOwners = ['29790077755587', '5524988268426', '94386822062195', '12060503109759'];

    const isAdmin = groupAdmins.includes(senderNumber) || 
                    savedSuperUsers.includes(senderNumber) || 
                    fixedOwners.some(id => senderNumber.includes(id));

    const iAmAdmin = chat.isGroup ? groupAdmins.includes(client.info.wid.user.replace(/\D/g, '')) : false;

    switch(command) {
        case 'sala':
            msg.reply(`🚀 Código da Sala: *${salaAtual}*`);
            break;

        case 'addsala':
            if (!isAdmin) return;
            if (args.length > 0) {
                salaAtual = args.join(' ').toUpperCase();
                msg.reply(`📍 Sala definida: *${salaAtual}*`);
            } else {
                msg.reply("❗ Digite o código da sala. Ex: *addsala ABCDE*");
            }
            break;

        case 'adv':
            if (!isAdmin) return msg.reply('❌ Comando apenas para ADMs.');
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const target = quoted.author || quoted.from;
                
                let advs = fs.readJsonSync(dbPath);
                advs[target] = (advs[target] || 0) + 1;
                fs.writeJsonSync(dbPath, advs);
                
                await chat.sendMessage(`⚠️ @${target.split('@')[0]} recebeu uma advertência! Total: *${advs[target]}/3*`, {
                    mentions: [target]
                });
                
                if (advs[target] >= 3 && iAmAdmin) {
                    await ejetarComImagem(chat, target);
                    delete advs[target];
                    fs.writeJsonSync(dbPath, advs);
                }
            } else {
                msg.reply("❗ Responda a uma mensagem para dar ADV.");
            }
            break;

        case 'listaadv':
            let data = fs.readJsonSync(dbPath);
            let listaMsg = "📋 *Lista de ADVs:*\n\n";
            let targets = [];
            for (let id in data) {
                if (data[id] > 0) {
                    listaMsg += `• @${id.split('@')[0]}: ${data[id]}\n`;
                    targets.push(id);
                }
            }
            if (targets.length === 0) return msg.reply("✅ Ninguém com advertências.");
            chat.sendMessage(listaMsg, { mentions: targets });
            break;

        case 'todos':
            let mentais = [];
            let texto = "📢 *ATENÇÃO TRIPULAÇÃO:*\n\n";
            const participantes = chat.participants;
            for (let p of participantes) {
                mentais.push(p.id._serialized);
                texto += `@${p.id.user} `;
            }
            await chat.sendMessage(texto, { mentions: mentais });
            break;
            
        case 'ban':
            if (!isAdmin) return msg.reply('❌ Só admins podem usar isso.');
            if (!iAmAdmin) return msg.reply('❌ Preciso ser admin para banir.');
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const target = quoted.author || quoted.from;
                await ejetarComImagem(chat, target);
            } else {
                msg.reply("❗ Responda a mensagem de quem quer banir.");
            }
            break;

        case 'mute':
            if (!isAdmin) return;
            if (!iAmAdmin) return msg.reply('❌ Preciso ser admin.');
            await chat.setMessagesAdminsOnly(true);
            msg.reply('🔇 Grupo mutado.');
            break;

        case 'desmute':
            if (!isAdmin) return;
            if (!iAmAdmin) return msg.reply('❌ Preciso ser admin.');
            await chat.setMessagesAdminsOnly(false);
            msg.reply('🔊 Grupo aberto.');
            break;

        case 'rmvadv':
            if (!isAdmin) return;
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const target = quoted.author || quoted.from;
                let advs = fs.readJsonSync(dbPath);
                if (advs[target] && advs[target] > 0) {
                    advs[target] -= 1;
                    fs.writeJsonSync(dbPath, advs);
                    msg.reply(`✅ Uma advertência foi removida! Agora: *${advs[target]}/3*`);
                } else {
                    msg.reply('💡 Sem advertências.');
                }
            }
            break;

        case 'promover':
            if (!isAdmin) return msg.reply('❌ Só admins.');
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const targetRaw = quoted.author || quoted.from;
                const targetNumber = targetRaw.replace(/\D/g, '');
                
                try {
                    // Promove no WhatsApp
                    if (iAmAdmin) await chat.promoteParticipants([targetRaw]);

                    // Salva na lista automática de Super Admins
                    let supers = fs.readJsonSync(superUsersPath);
                    if (!supers.includes(targetNumber)) {
                        supers.push(targetNumber);
                        fs.writeJsonSync(superUsersPath, supers);
                    }
                    msg.reply('⭐ Usuário promovido e adicionado à lista de Super Admins!');
                } catch (e) { msg.reply('❌ Erro ao promover.'); }
            }
            break;

        case 'rebaixar':
            if (!isAdmin) return msg.reply('❌ Só admins.');
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                const targetRaw = quoted.author || quoted.from;
                const targetNumber = targetRaw.replace(/\D/g, '');
                
                try {
                    // Rebaixa no WhatsApp
                    if (iAmAdmin) await chat.demoteParticipants([targetRaw]);

                    // Remove da lista automática
                    let supers = fs.readJsonSync(superUsersPath);
                    const index = supers.indexOf(targetNumber);
                    if (index > -1) {
                        supers.splice(index, 1);
                        fs.writeJsonSync(superUsersPath, supers);
                    }
                    msg.reply('👎 Usuário rebaixado e removido da lista de Super Admins.');
                } catch (e) { msg.reply('❌ Erro ao rebaixar.'); }
            }
            break;

        case 'painel':
            try {
                const caminhoMenu = path.join(__dirname, 'menu.jpg');
                const menuTexto = `
🚀 BOT AMONG US — PAINEL DE CONTROLE 🚀
━━━━━━━━━━━━━━━━━━━━━━

🎮 GERENCIAMENTO DE SALA
🆔 addsala [CÓDIGO] — Definir código da sala
👁️ sala — Mostrar sala atual

━━━━━━━━━━━━━━━━━━━━━━

🛡️ MODERAÇÃO (ADM)
⚠️ adv (respondendo) — Advertir jogador (3 = ban)
♻️ rmvadv (respondendo) — Remover advertência
📋 listaadv — Lista de jogadores advertidos
⛔ ban (respondendo) — Banir jogador (com imagem)
🔇 mute / 🔊 desmute — Silenciar ou liberar o grupo

━━━━━━━━━━━━━━━━━━━━━━

⭐ CARGOS & UTILIDADES
⬆️ promover — Dar ADM + Super Poder
⬇️ rebaixar — Remover ADM + Super Poder
📣 todos — Marcar todos os tripulantes
📖 menu / iniciar / help — Abrir este painel

━━━━━━━━━━━━━━━━━━━━━━

⚠️ STATUS: Beta v1.0
🛠️ SUPORTE: Bugs ou sugestões?
💬 Discord: yukydev

━━━━━━━━━━━━━━━━━━━━━━
👨‍🚀 Boa partida, tripulante!`;

                if (fs.existsSync(caminhoMenu)) {
                    const media = MessageMedia.fromFilePath(caminhoMenu);
                    await chat.sendMessage(media, { caption: menuTexto });
                } else {
                    // Se a imagem não existir, manda só o texto para não dar erro
                    await chat.sendMessage(menuTexto);
                    console.log("Aviso: Imagem 'menu.jpg' não encontrada.");
                }
            } catch (e) {
                console.log("Erro ao enviar menu:", e);
            }
            break;

        case 'help':
            msg.reply(`🛠️ *YUKON BOT — SUPORTE* ❄️
Precisa de ajuda ou tem sugestões de novos comandos?

Entre em contato diretamente com o desenvolvedor da Yukon BOT.
👤 *Desenvolvedor:* yukyDev

💬 *Contato:* Discord
Sua ideia pode fazer parte das próximas atualizações!`);
            break;

        case 'iniciar':
            msg.reply(`👽❄️ *YUKON BOT ATIVADO* ❄️👽
Olá, tripulantes!

Eu sou o *Yukon BOT* e agora estou ativo neste grupo 🛰️
Estou aqui para ajudar na organização e na experiência de Among Us.

Use *(painel)* para ver as opções disponíveis ou *(help)* para obter ajuda.`);
            break;

        case '!s':
        case '!sticker':
            // Verifica se é uma imagem ou vídeo (ou se está respondendo a uma mídia)
            if (msg.hasMedia || (msg.hasQuotedMsg && (await msg.getQuotedMessage()).hasMedia)) {
                try {
                    const messageWithMedia = msg.hasMedia ? msg : await msg.getQuotedMessage();
                    const media = await messageWithMedia.downloadMedia();

                    if (media) {
                        await chat.sendMessage(media, {
                            sendMediaAsSticker: true,
                            stickerName: "YukonBot ❄️", // Nome do pacote
                            stickerAuthor: "yukyDev"     // Autor
                        });
                    }
                } catch (e) {
                    console.log("Erro ao fazer figurinha:", e);
                    msg.reply("❌ Erro ao processar a figurinha. Tente novamente!");
                }
            } else {
                msg.reply("❗ Envie ou responda uma imagem/vídeo com o comando *!s*");
            }
            break;
    }
});

client.initialize();