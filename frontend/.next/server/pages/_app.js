/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "pages/_app";
exports.ids = ["pages/_app"];
exports.modules = {

/***/ "./styles/toast.module.css":
/*!*********************************!*\
  !*** ./styles/toast.module.css ***!
  \*********************************/
/***/ ((module) => {

eval("// Exports\nmodule.exports = {\n\t\"stack\": \"toast_stack__C14U2\",\n\t\"toast\": \"toast_toast__bD6cB\",\n\t\"slideIn\": \"toast_slideIn__r8Z2K\",\n\t\"success\": \"toast_success__VYOai\",\n\t\"error\": \"toast_error__OVWWy\",\n\t\"info\": \"toast_info__NhVpm\",\n\t\"dismiss\": \"toast_dismiss__n5L1h\"\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9zdHlsZXMvdG9hc3QubW9kdWxlLmNzcyIsIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsInNvdXJjZXMiOlsid2VicGFjazovL2xvZ2luLWZyb250ZW5kLy4vc3R5bGVzL3RvYXN0Lm1vZHVsZS5jc3M/NjEwOCJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBFeHBvcnRzXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0XCJzdGFja1wiOiBcInRvYXN0X3N0YWNrX19DMTRVMlwiLFxuXHRcInRvYXN0XCI6IFwidG9hc3RfdG9hc3RfX2JENmNCXCIsXG5cdFwic2xpZGVJblwiOiBcInRvYXN0X3NsaWRlSW5fX3I4WjJLXCIsXG5cdFwic3VjY2Vzc1wiOiBcInRvYXN0X3N1Y2Nlc3NfX1ZZT2FpXCIsXG5cdFwiZXJyb3JcIjogXCJ0b2FzdF9lcnJvcl9fT1ZXV3lcIixcblx0XCJpbmZvXCI6IFwidG9hc3RfaW5mb19fTmhWcG1cIixcblx0XCJkaXNtaXNzXCI6IFwidG9hc3RfZGlzbWlzc19fbjVMMWhcIlxufTtcbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./styles/toast.module.css\n");

/***/ }),

/***/ "./lib/toast.js":
/*!**********************!*\
  !*** ./lib/toast.js ***!
  \**********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   ToastProvider: () => (/* binding */ ToastProvider),\n/* harmony export */   useToast: () => (/* binding */ useToast)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"react/jsx-dev-runtime\");\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _styles_toast_module_css__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../styles/toast.module.css */ \"./styles/toast.module.css\");\n/* harmony import */ var _styles_toast_module_css__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_styles_toast_module_css__WEBPACK_IMPORTED_MODULE_2__);\n\n\n\nconst ToastContext = /*#__PURE__*/ (0,react__WEBPACK_IMPORTED_MODULE_1__.createContext)(null);\nlet idCounter = 0;\nfunction ToastProvider({ children }) {\n    const [toasts, setToasts] = (0,react__WEBPACK_IMPORTED_MODULE_1__.useState)([]);\n    const timers = (0,react__WEBPACK_IMPORTED_MODULE_1__.useRef)({});\n    const dismiss = (0,react__WEBPACK_IMPORTED_MODULE_1__.useCallback)((id)=>{\n        setToasts((prev)=>prev.filter((t)=>t.id !== id));\n        clearTimeout(timers.current[id]);\n        delete timers.current[id];\n    }, []);\n    const showToast = (0,react__WEBPACK_IMPORTED_MODULE_1__.useCallback)((message, type = \"info\", duration = 4500)=>{\n        const id = ++idCounter;\n        setToasts((prev)=>[\n                ...prev,\n                {\n                    id,\n                    message,\n                    type\n                }\n            ]);\n        timers.current[id] = setTimeout(()=>dismiss(id), duration);\n    }, [\n        dismiss\n    ]);\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(ToastContext.Provider, {\n        value: {\n            showToast\n        },\n        children: [\n            children,\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"div\", {\n                className: (_styles_toast_module_css__WEBPACK_IMPORTED_MODULE_2___default().stack),\n                \"aria-live\": \"polite\",\n                \"aria-atomic\": \"true\",\n                children: toasts.map((t)=>/*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"div\", {\n                        className: `${(_styles_toast_module_css__WEBPACK_IMPORTED_MODULE_2___default().toast)} ${(_styles_toast_module_css__WEBPACK_IMPORTED_MODULE_2___default())[t.type] || \"\"}`,\n                        role: \"status\",\n                        children: [\n                            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"span\", {\n                                children: t.message\n                            }, void 0, false, {\n                                fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\lib\\\\toast.js\",\n                                lineNumber: 30,\n                                columnNumber: 13\n                            }, this),\n                            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"button\", {\n                                className: (_styles_toast_module_css__WEBPACK_IMPORTED_MODULE_2___default().dismiss),\n                                onClick: ()=>dismiss(t.id),\n                                \"aria-label\": \"Dismiss notification\",\n                                children: \"\\xd7\"\n                            }, void 0, false, {\n                                fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\lib\\\\toast.js\",\n                                lineNumber: 31,\n                                columnNumber: 13\n                            }, this)\n                        ]\n                    }, t.id, true, {\n                        fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\lib\\\\toast.js\",\n                        lineNumber: 29,\n                        columnNumber: 11\n                    }, this))\n            }, void 0, false, {\n                fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\lib\\\\toast.js\",\n                lineNumber: 27,\n                columnNumber: 7\n            }, this)\n        ]\n    }, void 0, true, {\n        fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\lib\\\\toast.js\",\n        lineNumber: 25,\n        columnNumber: 5\n    }, this);\n}\nfunction useToast() {\n    const ctx = (0,react__WEBPACK_IMPORTED_MODULE_1__.useContext)(ToastContext);\n    if (!ctx) throw new Error(\"useToast must be used within a ToastProvider\");\n    return ctx;\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9saWIvdG9hc3QuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQWlGO0FBQ2pDO0FBRWhELE1BQU1NLDZCQUFlTixvREFBYUEsQ0FBQztBQUVuQyxJQUFJTyxZQUFZO0FBRVQsU0FBU0MsY0FBYyxFQUFFQyxRQUFRLEVBQUU7SUFDeEMsTUFBTSxDQUFDQyxRQUFRQyxVQUFVLEdBQUdQLCtDQUFRQSxDQUFDLEVBQUU7SUFDdkMsTUFBTVEsU0FBU1QsNkNBQU1BLENBQUMsQ0FBQztJQUV2QixNQUFNVSxVQUFVWixrREFBV0EsQ0FBQyxDQUFDYTtRQUMzQkgsVUFBVSxDQUFDSSxPQUFTQSxLQUFLQyxNQUFNLENBQUMsQ0FBQ0MsSUFBTUEsRUFBRUgsRUFBRSxLQUFLQTtRQUNoREksYUFBYU4sT0FBT08sT0FBTyxDQUFDTCxHQUFHO1FBQy9CLE9BQU9GLE9BQU9PLE9BQU8sQ0FBQ0wsR0FBRztJQUMzQixHQUFHLEVBQUU7SUFFTCxNQUFNTSxZQUFZbkIsa0RBQVdBLENBQUMsQ0FBQ29CLFNBQVNDLE9BQU8sTUFBTSxFQUFFQyxXQUFXLElBQUk7UUFDcEUsTUFBTVQsS0FBSyxFQUFFUDtRQUNiSSxVQUFVLENBQUNJLE9BQVM7bUJBQUlBO2dCQUFNO29CQUFFRDtvQkFBSU87b0JBQVNDO2dCQUFLO2FBQUU7UUFDcERWLE9BQU9PLE9BQU8sQ0FBQ0wsR0FBRyxHQUFHVSxXQUFXLElBQU1YLFFBQVFDLEtBQUtTO0lBQ3JELEdBQUc7UUFBQ1Y7S0FBUTtJQUVaLHFCQUNFLDhEQUFDUCxhQUFhbUIsUUFBUTtRQUFDQyxPQUFPO1lBQUVOO1FBQVU7O1lBQ3ZDWDswQkFDRCw4REFBQ2tCO2dCQUFJQyxXQUFXdkIsdUVBQVk7Z0JBQUV5QixhQUFVO2dCQUFTQyxlQUFZOzBCQUMxRHJCLE9BQU9zQixHQUFHLENBQUMsQ0FBQ2Ysa0JBQ1gsOERBQUNVO3dCQUFlQyxXQUFXLENBQUMsRUFBRXZCLHVFQUFZLENBQUMsQ0FBQyxFQUFFQSxpRUFBTSxDQUFDWSxFQUFFSyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUM7d0JBQUVZLE1BQUs7OzBDQUN6RSw4REFBQ0M7MENBQU1sQixFQUFFSSxPQUFPOzs7Ozs7MENBQ2hCLDhEQUFDZTtnQ0FDQ1IsV0FBV3ZCLHlFQUFjO2dDQUN6QmdDLFNBQVMsSUFBTXhCLFFBQVFJLEVBQUVILEVBQUU7Z0NBQzNCd0IsY0FBVzswQ0FDWjs7Ozs7Ozt1QkFOT3JCLEVBQUVILEVBQUU7Ozs7Ozs7Ozs7Ozs7Ozs7QUFjeEI7QUFFTyxTQUFTeUI7SUFDZCxNQUFNQyxNQUFNdEMsaURBQVVBLENBQUNJO0lBQ3ZCLElBQUksQ0FBQ2tDLEtBQUssTUFBTSxJQUFJQyxNQUFNO0lBQzFCLE9BQU9EO0FBQ1QiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9sb2dpbi1mcm9udGVuZC8uL2xpYi90b2FzdC5qcz9jZTdhIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUNvbnRleHQsIHVzZUNhbGxiYWNrLCB1c2VDb250ZXh0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHN0eWxlcyBmcm9tICcuLi9zdHlsZXMvdG9hc3QubW9kdWxlLmNzcyc7XG5cbmNvbnN0IFRvYXN0Q29udGV4dCA9IGNyZWF0ZUNvbnRleHQobnVsbCk7XG5cbmxldCBpZENvdW50ZXIgPSAwO1xuXG5leHBvcnQgZnVuY3Rpb24gVG9hc3RQcm92aWRlcih7IGNoaWxkcmVuIH0pIHtcbiAgY29uc3QgW3RvYXN0cywgc2V0VG9hc3RzXSA9IHVzZVN0YXRlKFtdKTtcbiAgY29uc3QgdGltZXJzID0gdXNlUmVmKHt9KTtcblxuICBjb25zdCBkaXNtaXNzID0gdXNlQ2FsbGJhY2soKGlkKSA9PiB7XG4gICAgc2V0VG9hc3RzKChwcmV2KSA9PiBwcmV2LmZpbHRlcigodCkgPT4gdC5pZCAhPT0gaWQpKTtcbiAgICBjbGVhclRpbWVvdXQodGltZXJzLmN1cnJlbnRbaWRdKTtcbiAgICBkZWxldGUgdGltZXJzLmN1cnJlbnRbaWRdO1xuICB9LCBbXSk7XG5cbiAgY29uc3Qgc2hvd1RvYXN0ID0gdXNlQ2FsbGJhY2soKG1lc3NhZ2UsIHR5cGUgPSAnaW5mbycsIGR1cmF0aW9uID0gNDUwMCkgPT4ge1xuICAgIGNvbnN0IGlkID0gKytpZENvdW50ZXI7XG4gICAgc2V0VG9hc3RzKChwcmV2KSA9PiBbLi4ucHJldiwgeyBpZCwgbWVzc2FnZSwgdHlwZSB9XSk7XG4gICAgdGltZXJzLmN1cnJlbnRbaWRdID0gc2V0VGltZW91dCgoKSA9PiBkaXNtaXNzKGlkKSwgZHVyYXRpb24pO1xuICB9LCBbZGlzbWlzc10pO1xuXG4gIHJldHVybiAoXG4gICAgPFRvYXN0Q29udGV4dC5Qcm92aWRlciB2YWx1ZT17eyBzaG93VG9hc3QgfX0+XG4gICAgICB7Y2hpbGRyZW59XG4gICAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLnN0YWNrfSBhcmlhLWxpdmU9XCJwb2xpdGVcIiBhcmlhLWF0b21pYz1cInRydWVcIj5cbiAgICAgICAge3RvYXN0cy5tYXAoKHQpID0+IChcbiAgICAgICAgICA8ZGl2IGtleT17dC5pZH0gY2xhc3NOYW1lPXtgJHtzdHlsZXMudG9hc3R9ICR7c3R5bGVzW3QudHlwZV0gfHwgJyd9YH0gcm9sZT1cInN0YXR1c1wiPlxuICAgICAgICAgICAgPHNwYW4+e3QubWVzc2FnZX08L3NwYW4+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgIGNsYXNzTmFtZT17c3R5bGVzLmRpc21pc3N9XG4gICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IGRpc21pc3ModC5pZCl9XG4gICAgICAgICAgICAgIGFyaWEtbGFiZWw9XCJEaXNtaXNzIG5vdGlmaWNhdGlvblwiXG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgIMOXXG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgKSl9XG4gICAgICA8L2Rpdj5cbiAgICA8L1RvYXN0Q29udGV4dC5Qcm92aWRlcj5cbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVzZVRvYXN0KCkge1xuICBjb25zdCBjdHggPSB1c2VDb250ZXh0KFRvYXN0Q29udGV4dCk7XG4gIGlmICghY3R4KSB0aHJvdyBuZXcgRXJyb3IoJ3VzZVRvYXN0IG11c3QgYmUgdXNlZCB3aXRoaW4gYSBUb2FzdFByb3ZpZGVyJyk7XG4gIHJldHVybiBjdHg7XG59XG4iXSwibmFtZXMiOlsiY3JlYXRlQ29udGV4dCIsInVzZUNhbGxiYWNrIiwidXNlQ29udGV4dCIsInVzZVJlZiIsInVzZVN0YXRlIiwic3R5bGVzIiwiVG9hc3RDb250ZXh0IiwiaWRDb3VudGVyIiwiVG9hc3RQcm92aWRlciIsImNoaWxkcmVuIiwidG9hc3RzIiwic2V0VG9hc3RzIiwidGltZXJzIiwiZGlzbWlzcyIsImlkIiwicHJldiIsImZpbHRlciIsInQiLCJjbGVhclRpbWVvdXQiLCJjdXJyZW50Iiwic2hvd1RvYXN0IiwibWVzc2FnZSIsInR5cGUiLCJkdXJhdGlvbiIsInNldFRpbWVvdXQiLCJQcm92aWRlciIsInZhbHVlIiwiZGl2IiwiY2xhc3NOYW1lIiwic3RhY2siLCJhcmlhLWxpdmUiLCJhcmlhLWF0b21pYyIsIm1hcCIsInRvYXN0Iiwicm9sZSIsInNwYW4iLCJidXR0b24iLCJvbkNsaWNrIiwiYXJpYS1sYWJlbCIsInVzZVRvYXN0IiwiY3R4IiwiRXJyb3IiXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///./lib/toast.js\n");

/***/ }),

/***/ "./pages/_app.js":
/*!***********************!*\
  !*** ./pages/_app.js ***!
  \***********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ App)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"react/jsx-dev-runtime\");\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_head__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/head */ \"next/head\");\n/* harmony import */ var next_head__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(next_head__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _styles_globals_css__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../styles/globals.css */ \"./styles/globals.css\");\n/* harmony import */ var _styles_globals_css__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_styles_globals_css__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var _lib_toast__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../lib/toast */ \"./lib/toast.js\");\n\n\n\n\nfunction App({ Component, pageProps }) {\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.Fragment, {\n        children: [\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)((next_head__WEBPACK_IMPORTED_MODULE_1___default()), {\n                children: [\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"title\", {\n                        children: \"IssueTrack\"\n                    }, void 0, false, {\n                        fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\pages\\\\_app.js\",\n                        lineNumber: 9,\n                        columnNumber: 9\n                    }, this),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"meta\", {\n                        name: \"viewport\",\n                        content: \"width=device-width, initial-scale=1\"\n                    }, void 0, false, {\n                        fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\pages\\\\_app.js\",\n                        lineNumber: 10,\n                        columnNumber: 9\n                    }, this)\n                ]\n            }, void 0, true, {\n                fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\pages\\\\_app.js\",\n                lineNumber: 8,\n                columnNumber: 7\n            }, this),\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(_lib_toast__WEBPACK_IMPORTED_MODULE_3__.ToastProvider, {\n                children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(Component, {\n                    ...pageProps\n                }, void 0, false, {\n                    fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\pages\\\\_app.js\",\n                    lineNumber: 13,\n                    columnNumber: 9\n                }, this)\n            }, void 0, false, {\n                fileName: \"C:\\\\Users\\\\vigne\\\\Downloads\\\\login\\\\login-app-nextjs-nestjs-mysql\\\\project\\\\frontend\\\\pages\\\\_app.js\",\n                lineNumber: 12,\n                columnNumber: 7\n            }, this)\n        ]\n    }, void 0, true);\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9wYWdlcy9fYXBwLmpzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUE2QjtBQUNFO0FBQ2M7QUFFOUIsU0FBU0UsSUFBSSxFQUFFQyxTQUFTLEVBQUVDLFNBQVMsRUFBRTtJQUNsRCxxQkFDRTs7MEJBQ0UsOERBQUNKLGtEQUFJQTs7a0NBQ0gsOERBQUNLO2tDQUFNOzs7Ozs7a0NBQ1AsOERBQUNDO3dCQUFLQyxNQUFLO3dCQUFXQyxTQUFROzs7Ozs7Ozs7Ozs7MEJBRWhDLDhEQUFDUCxxREFBYUE7MEJBQ1osNEVBQUNFO29CQUFXLEdBQUdDLFNBQVM7Ozs7Ozs7Ozs7Ozs7QUFJaEMiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9sb2dpbi1mcm9udGVuZC8uL3BhZ2VzL19hcHAuanM/ZTBhZCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgSGVhZCBmcm9tICduZXh0L2hlYWQnO1xuaW1wb3J0ICcuLi9zdHlsZXMvZ2xvYmFscy5jc3MnO1xuaW1wb3J0IHsgVG9hc3RQcm92aWRlciB9IGZyb20gJy4uL2xpYi90b2FzdCc7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEFwcCh7IENvbXBvbmVudCwgcGFnZVByb3BzIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAgPEhlYWQ+XG4gICAgICAgIDx0aXRsZT5Jc3N1ZVRyYWNrPC90aXRsZT5cbiAgICAgICAgPG1ldGEgbmFtZT1cInZpZXdwb3J0XCIgY29udGVudD1cIndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xXCIgLz5cbiAgICAgIDwvSGVhZD5cbiAgICAgIDxUb2FzdFByb3ZpZGVyPlxuICAgICAgICA8Q29tcG9uZW50IHsuLi5wYWdlUHJvcHN9IC8+XG4gICAgICA8L1RvYXN0UHJvdmlkZXI+XG4gICAgPC8+XG4gICk7XG59XG4iXSwibmFtZXMiOlsiSGVhZCIsIlRvYXN0UHJvdmlkZXIiLCJBcHAiLCJDb21wb25lbnQiLCJwYWdlUHJvcHMiLCJ0aXRsZSIsIm1ldGEiLCJuYW1lIiwiY29udGVudCJdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///./pages/_app.js\n");

/***/ }),

/***/ "./styles/globals.css":
/*!****************************!*\
  !*** ./styles/globals.css ***!
  \****************************/
/***/ (() => {



/***/ }),

/***/ "next/head":
/*!****************************!*\
  !*** external "next/head" ***!
  \****************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/head");

/***/ }),

/***/ "react":
/*!************************!*\
  !*** external "react" ***!
  \************************/
/***/ ((module) => {

"use strict";
module.exports = require("react");

/***/ }),

/***/ "react/jsx-dev-runtime":
/*!****************************************!*\
  !*** external "react/jsx-dev-runtime" ***!
  \****************************************/
/***/ ((module) => {

"use strict";
module.exports = require("react/jsx-dev-runtime");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("./pages/_app.js"));
module.exports = __webpack_exports__;

})();