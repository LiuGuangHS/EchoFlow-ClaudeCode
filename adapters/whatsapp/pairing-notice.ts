import { ECHOFLOW_PRODUCT_NAME } from '../common/brand.js'

// Copy the adapter sends when an unpaired sender writes to the bot.
export function buildWhatsAppPairingNotice(success: boolean): string {
  return success
    ? '配对成功！现在可以开始聊天了。\n\n发送消息即可与 EchoFlow 对话。'
    : `未授权。请在 ${ECHOFLOW_PRODUCT_NAME} 桌面端生成配对码后发送给我。`
}
