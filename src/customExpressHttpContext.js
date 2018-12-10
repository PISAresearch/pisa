"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_http_context_1 = __importDefault(require("express-http-context"));
const uuid_1 = __importDefault(require("uuid"));
const REQUEST_ID = "requestId";
exports.setRequestId = () => {
    return express_http_context_1.default.set(REQUEST_ID, uuid_1.default.v1());
};
exports.getRequestId = () => {
    return express_http_context_1.default.get(REQUEST_ID);
};
