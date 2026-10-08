import { test, expect } from 'bun:test';
import { pickPanelChat } from '../twin';

const chats = [{ name: 'chat-cleaning' }, { name: 'chat-figures' }, { name: 'chat-wrapup' }];
test('M450h: panelChat names the chat the person sits in; without it the last-used chat is taken', () => {
  expect(pickPanelChat(chats, 'chat-figures').name).toBe('chat-figures');
  expect(pickPanelChat(chats, null).name).toBe('chat-wrapup');
  expect(pickPanelChat(chats, 'chat-nope').name).toBe('chat-wrapup');
});
