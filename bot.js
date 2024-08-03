const MTProto = require('mtproto-core');
const prompts = require('prompts');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const api = new MTProto({
  api_id: process.env.API_ID,
  api_hash: process.env.API_HASH,
  storageOptions: {
    path: path.resolve(__dirname, './storage.json')
  }
});

const phone = process.env.PHONE_NUMBER;

let lastMessageDate = 0;
const seenMessages = new Set(); // Множество для хранения обработанных сообщений

async function sendCode() {
  const result = await api.call('auth.sendCode', {
    phone_number: phone,
    settings: {
      _: 'codeSettings'
    }
  });
  return result;
}

async function signIn(code, phone_code_hash) {
  const result = await api.call('auth.signIn', {
    phone_number: phone,
    phone_code_hash,
    phone_code: code
  });
  return result;
}

async function loadSession() {
  if (fs.existsSync(path.resolve(__dirname, 'session.json'))) {
    const sessionData = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'session.json')));
    api.storage.set('user_auth', sessionData);
  }
}

async function saveSession() {
  const sessionData = api.storage.get('user_auth');
  fs.writeFileSync(path.resolve(__dirname, 'session.json'), JSON.stringify(sessionData, null, 2));
}

async function authorize() {
  try {
    await loadSession();

    const me = await api.call('users.getFullUser', { id: { _: 'inputUserSelf' } });
    console.log('Сессия загружена:', me);
  } catch (error) {
    if (error.error_message === 'AUTH_KEY_UNREGISTERED') {
      const { phone_code_hash } = await sendCode();

      const response = await prompts({
        type: 'text',
        name: 'code',
        message: 'Введите код, отправленный на ваш телефон'
      });

      const signInResult = await signIn(response.code, phone_code_hash);

      if (signInResult._ === 'auth.authorizationSignUpRequired') {
        throw new Error('Требуется регистрация');
      }

      console.log('Успешная авторизация', signInResult);

      await saveSession();
    } else {
      console.error('Ошибка авторизации', error);
    }
  }
}

async function getChatIdByAlias(alias) {
  try {
    const result = await api.call('contacts.resolveUsername', {
      username: alias
    });
    const chatId = result.chats[0].id;
    const accessHash = result.chats[0].access_hash;
    return { chatId, accessHash };
  } catch (error) {
    console.error('Ошибка получения идентификатора чата:', error);
  }
}

async function getLastMessages(chatId, accessHash, limit = 5) {
  try {
    const messages = await api.call('messages.getHistory', {
      peer: { _: 'inputPeerChannel', channel_id: chatId, access_hash: accessHash },
      offset_id: 0,
      offset_date: 0,
      add_offset: 0,
      limit: limit,
      max_id: 0,
      min_id: 0,
      hash: 0
    });

    return messages.messages.reverse(); // Возвращаем в хронологическом порядке
  } catch (error) {
    console.error('Ошибка получения последних сообщений:', error);
  }
}

async function processNewMessages(chatId, accessHash) {
  try {
    const messages = await api.call('messages.getHistory', {
      peer: { _: 'inputPeerChannel', channel_id: chatId, access_hash: accessHash },
      offset_id: 0,
      offset_date: 0,
      add_offset: 0,
      limit: 100,
      max_id: 0,
      min_id: 0,
      hash: 0
    });

    for (const message of messages.messages) {
      if (message.date > lastMessageDate && !seenMessages.has(message.id)) {
        seenMessages.add(message.id);
        console.log(`Сообщение: ${message.message}, ID пользователя: ${message.from_id.user_id}`);
        lastMessageDate = message.date; // Обновляем дату последнего сообщения
      }
    }
  } catch (error) {
    console.error('Ошибка обработки сообщений:', error);
  }
}

async function main() {
  await authorize();

  const chatAlias = 'tusa_ton'; // Укажите алиас чата
  const { chatId, accessHash } = await getChatIdByAlias(chatAlias);

  if (chatId && accessHash) {
    console.log(`Идентификатор чата: ${chatId}`);
    console.log(`Access Hash чата: ${accessHash}`);

    // Получаем последние 5 сообщений
    const lastMessages = await getLastMessages(chatId, accessHash);
    lastMessages.forEach(message => {
      if (message.message) {
        seenMessages.add(message.id);
        console.log(`Сообщение: ${message.message}, ID пользователя: ${message.from_id.user_id}`);
        lastMessageDate = message.date; // Обновляем дату последнего сообщения
      }
    });

    // Начало обработки новых сообщений
    setInterval(() => processNewMessages(chatId, accessHash), 10000);
  } else {
    console.error('Не удалось получить идентификатор или access hash чата');
  }
}

main();
