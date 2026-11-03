import { ECHOFLOW_PRODUCT_NAME } from '../common/brand.js'

// Copy the adapter sends when an unpaired sender writes to the bot.
export function buildWechatPairingNotice(success: boolean): string {
  return success
    ? '配对成功！现在可以开始聊天了。\n\n发送消息即可与 EchoFlow 对话。发送 /help 查看可用命令。'
    : `未授权。请先在 ${ECHOFLOW_PRODUCT_NAME} 桌面端完成微信扫码绑定，再生成 IM 配对码后发送给我。`
}
