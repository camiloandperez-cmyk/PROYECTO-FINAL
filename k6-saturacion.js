// Prueba de saturación: 80 peticiones/s a un endpoint lento (500 ms) durante 60 s.
// Capacidad teórica: 3 backends x 8 hilos / 0,5 s = 48 peticiones/s, así que se satura.
// Uso:  k6 run loadtest/k6-saturacion.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  scenarios: {
    saturacion: {
      executor: 'constant-arrival-rate',
      rate: 80,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 200,
      maxVUs: 1000,
    },
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/slow?ms=500`, { timeout: '10s' });
  check(res, { 'status 200': (r) => r.status === 200 });
}
