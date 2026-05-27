export type SanitizedResponse = {
  message: string;
  transferToSales: boolean;
};

export function sanitizeAgentResponse(raw: string): SanitizedResponse {
  let response = raw || '';
  let transferToSales = false;

  if (response.includes('[TRANSFERIR_A_VENTAS]')) {
    transferToSales = true;
    response = response.replace('[TRANSFERIR_A_VENTAS]', '').trim();
  }

  response = response
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1: $2')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (response.length > 4000) {
    response = response.substring(0, 3997) + '...';
  }

  return { message: response, transferToSales };
}
