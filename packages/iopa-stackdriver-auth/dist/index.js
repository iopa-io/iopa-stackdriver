"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
__export(require("./generated-logging"));
var generated_error_reporting_1 = require("./generated-error-reporting");
exports.ErrorReportingApi = generated_error_reporting_1.ProjectsApi;
var token_service_1 = require("./auth/token-service");
exports.TokenService = token_service_1.TokenService;
//# sourceMappingURL=index.js.map