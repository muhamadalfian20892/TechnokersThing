export type ConnectorType = 'blogger' | 'gmail' | 'webhook' | 'custom_api';

export interface ConnectorAuth {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ConnectorParams {
  blogId?: string;
  recipientEmail?: string;
  webhookUrl?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
}

export interface ConnectorConfig {
  id: string;
  name: string;
  type: ConnectorType;
  enabled: boolean;
  auth: ConnectorAuth;
  params: ConnectorParams;
  createdAt: string;
  lastUsedAt?: string;
  description?: string;
}

export interface ConnectorExecutionResult {
  success: boolean;
  message: string;
  data?: any;
}
