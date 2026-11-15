import { http } from '../http';
import type {
  ConfirmOrderResponse,
  CreateOrderInput,
  OrderDto,
  PageQuery,
  Paged,
  PlanDto,
  SubscriptionDto,
} from '../types';

/** EXEC only. Sandbox payments: no card data ever reaches the app or the API. */
export const subscriptionApi = {
  plans: () => http.get<PlanDto[]>('/plans'),
  current: () => http.get<SubscriptionDto | null>('/subscription'),
  createOrder: (input: CreateOrderInput) => http.post<OrderDto>('/subscription/orders', input),
  confirmSandbox: (orderId: string) =>
    http.post<ConfirmOrderResponse>(`/subscription/orders/${orderId}/confirm-sandbox`),
  orders: (q: PageQuery = {}) => http.get<Paged<OrderDto>>('/subscription/orders', { query: { ...q } }),
  cancel: () => http.post<SubscriptionDto>('/subscription/cancel'),
};
