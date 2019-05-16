/**
 * @fileoverview HW object class for connect arduino.
 */
'use strict';

import HardwareSocketMessageHandler from './hardware/hardwareSocketMessageHandler';

require('../playground/blocks');

Entry.HW2 = class {
    // 하드웨어 프로그램 접속용 주소 (https)
    get httpsServerAddress() {
        return 'https://hardware.playentry.org:23518';
    }

    // 하드웨어 프로그램 접속용 주소 (https)
    get httpsServerAddress2() {
        return 'https://hardware.play-entry.org:23518';
    }

    // 하드웨어 프로그램 접속용 주소 (http)
    get httpServerAddress() {
        return 'http://127.0.0.1:23518';
    }

    constructor() {
        this.sessionRoomId = localStorage.getItem('entryhwRoomId');
        if (!this.sessionRoomId) {
            this.sessionRoomId = this._createRandomRoomId();
            localStorage.setItem('entryhwRoomId', this.sessionRoomId);
        }

        this.TRIAL_LIMIT = 2;
        this.connected = false;
        this.portData = {};
        this.sendQueue = {};
        this.selectedDevice = null;
        this.hwModule = null;
        this.socketType = null;

        this.hwPopupCreate();
        this._initSocket();

        Entry.addEventListener('stop', this.setZero);
    }

    _createRandomRoomId() {
        return 'xxxxxxxxyx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    _connectWebSocket(url, option) {
        const socket = io(url, option);
        socket.io.reconnectionAttempts(this.TRIAL_LIMIT);
        socket.io.reconnectionDelayMax(1000);
        socket.io.timeout(1000);
        socket.on('connect', () => {
            this.socketType = 'WebSocket';
            this._initHardware(socket);
        });

        socket.on('mode', (mode) => {
            if (socket.mode === 0 && mode === 1) {
                this._disconnectHardware();
            }
            this.socketMode = mode;
            socket.mode = mode;
        });

        const messageHandler = new HardwareSocketMessageHandler(socket);
        messageHandler.addEventListener('init', this.requestHardwareModule.bind(this));
        messageHandler.addEventListener('state', (statement) => {
            switch (statement) {
                case 'disconnectHardware':
                    this._disconnectHardware();
                    break;
            }
        });

        // 1.7.0 버전 이전 하드웨어 프로그램 종료로직 대응으로 남겨두어야 한다.
        messageHandler.addEventListener('disconnect', this._disconnectHardware.bind(this));
        messageHandler.addEventListener('data', (portData) => {
            this.checkDevice(portData);
            this.updatePortData(portData);
        });

        socket.on('disconnect', () => {
            // this._initSocket();
            this.disconnectedSocket();
        });

        return socket;
    }

    _initSocket() {
        this.connected = false;

        this.tlsSocketIo1 && this.tlsSocketIo1.removeAllListeners();
        this.tlsSocketIo2 && this.tlsSocketIo2.removeAllListeners();
        this.socketIo && this.socketIo.removeAllListeners();

        const connectHttpsWebSocket = (url) =>
            this._connectWebSocket(url, {
                query: {
                    client: true,
                    roomId: this.sessionRoomId,
                },
            });

        if (location.protocol.indexOf('http') > -1) {
            this.socketIo = connectHttpsWebSocket(this.httpServerAddress);
        }
        this.tlsSocketIo1 = connectHttpsWebSocket(this.httpsServerAddress);
        this.tlsSocketIo2 = connectHttpsWebSocket(this.httpsServerAddress2);

        Entry.dispatchEvent('hwChanged');
    }

    retryConnect() {
        this.isOpenHardware = false;
        this.TRIAL_LIMIT = 5;
        this._initSocket();
    }

    openHardwareProgram() {
        this.isOpenHardware = true;
        this.TRIAL_LIMIT = 5;
        this.executeHardware();

        if (!this.socket || !this.socket.connected) {
            setTimeout(() => {
                this._initSocket();
            }, 1000);
        }
    }

    _initHardware(socket) {
        this.socket = socket;
        this.connected = true;
        console.log('Hardware Program connected'); // 하드웨어 프로그램 연결 성공, 스테이터스 변화 필요
        Entry.dispatchEvent('hwChanged');
        if (Entry.playground && Entry.playground.object) {
            Entry.playground.setMenu(Entry.playground.object.objectType);
        }
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * 하드웨어 프로그램에 moduleName 에 맞는 파일을 요청하도록 신호를 보낸다.
     * entryjs 가 하드웨어 프로그램과 연동되어있는 경우만 실행된다.
     * 이 함수는 entryjs 외부에서 사용한다.
     * @param {string} moduleName
     */
    requestHardwareModule(moduleName) {
        if (this.connected && this.socket) {
            this._sendSocketMessage({
                action: 'init',
                data: JSON.stringify({ name: moduleName }),
                mode: this.socket.mode,
                type: 'utf8',
            });
        } else {
            // 하드웨어가 연결되어있지 않은 경우의 처리
            Entry.toast.warning('모듈 로드하기', '하드웨어 프로그램이 연결되어있지 않습니다.');
        }
    }

    _disconnectHardware() {
        Entry.propertyPanel && Entry.propertyPanel.removeMode('hw');
        this.selectedDevice = undefined;
        this.hwModule = undefined;
        Entry.dispatchEvent('hwChanged');
    }

    disconnectedSocket() {
        if (this.connected) {
            this.tlsSocketIo1 && this.tlsSocketIo1.close();
            this.tlsSocketIo2 && this.tlsSocketIo2.close();
            this.socketIo && this.socketIo.close();

            Entry.propertyPanel && Entry.propertyPanel.removeMode('hw');
            this.socket = undefined;
            this.connected = false;
            this.selectedDevice = undefined;
            this.hwModule = undefined;
            Entry.dispatchEvent('hwChanged');
            Entry.toast.alert(
                '하드웨어 프로그램 연결 종료',
                '하드웨어 프로그램과의 연결이 종료되었습니다.',
                false
            );
        }
    }

    setDigitalPortValue(port, value) {
        this.sendQueue[port] = value;
        this.removePortReadable(port);
    }

    getAnalogPortValue(port) {
        if (!this.connected) {
            return 0;
        }
        return this.portData[`a${port}`];
    }

    getDigitalPortValue(port) {
        if (!this.connected) {
            return 0;
        }
        this.setPortReadable(port);
        if (this.portData[port] !== undefined) {
            return this.portData[port];
        } else {
            return 0;
        }
    }

    setPortReadable(port) {
        if (!this.sendQueue.readablePorts) {
            this.sendQueue.readablePorts = [];
        }

        let isPass = false;
        for (const i in this.sendQueue.readablePorts) {
            if (this.sendQueue.readablePorts[i] == port) {
                isPass = true;
                break;
            }
        }

        if (!isPass) {
            this.sendQueue.readablePorts.push(port);
        }
    }

    removePortReadable(port) {
        if (!this.sendQueue.readablePorts && !Array.isArray(this.sendQueue.readablePorts)) {
            return;
        }
        let target;
        for (const i in this.sendQueue.readablePorts) {
            if (this.sendQueue.readablePorts[i] == port) {
                target = Number(i);
                break;
            }
        }

        if (target != undefined) {
            this.sendQueue.readablePorts = this.sendQueue.readablePorts
                .slice(0, target)
                .concat(
                    this.sendQueue.readablePorts.slice(
                        target + 1,
                        this.sendQueue.readablePorts.length
                    )
                );
        }
    }

    update() {
        if (!this.socket || this.socket.disconnected) {
            return;
        }
        if (this.hwModule && this.hwModule.sendMessage) {
            this.hwModule.sendMessage(this);
        } else {
            this._sendSocketMessage({
                data: JSON.stringify(this.sendQueue),
                mode: this.socket.mode,
                type: 'utf8',
            });
        }
    }

    _sendSocketMessage(message) {
        if (this.connected && this.socket && !this.socket.disconnected) {
            this.socket.emit('message', message);
        }
    }

    updatePortData(data) {
        this.portData = data;
        if (this.hwMonitor && Entry.propertyPanel && Entry.propertyPanel.selected === 'hw') {
            this.hwMonitor.update(this.portData, this.sendQueue);
        }
        if (this.hwModule && this.hwModule.afterReceive) {
            this.hwModule.afterReceive(this.portData);
        }
    }

    closeConnection() {
        if (this.socket) {
            this.socket.close();
        }
    }

    downloadConnector() {
        Entry.dispatchEvent('hwDownload', 'hardware');
    }

    downloadGuide() {
        Entry.dispatchEvent('hwDownload', 'manual');
    }

    downloadSource() {
        Entry.dispatchEvent('hwDownload', 'ino');
    }

    requestModulePage() {
        Entry.dispatchEvent('hwModule');
    }

    setZero() {
        if (!Entry.hw.hwModule) {
            return;
        }
        Entry.hw.hwModule.setZero();
    }

    checkDevice(data) {
        if (data.company === undefined) {
            return;
        }
        const key = [
            Entry.Utils.convertIntToHex(data.company),
            '.',
            Entry.Utils.convertIntToHex(data.model),
        ].join('');
        if (key === this.selectedDevice) {
            if (this.hwModule && this.hwModule.dataHandler) {
                this.hwModule.dataHandler(data);
            }
            return;
        }

        this.selectedDevice = key;
        this.hwModule = Entry.HARDWARE_LIST[key];
        if (!this.hwModule) {
            return;
        }
        Entry.dispatchEvent('hwChanged');

        let descMsg = '';
        if (Entry.propertyPanel && this.hwModule.monitorTemplate) {
            descMsg = Lang.Msgs.hw_connection_success_desc;
            this._setHardwareMonitorTemplate();
        } else {
            descMsg = Lang.Msgs.hw_connection_success_desc2;
        }
        Entry.toast.success(Lang.Msgs.hw_connection_success, descMsg);
    }

    _setHardwareMonitorTemplate() {
        if (!this.hwMonitor) {
            this.hwMonitor = new Entry.HWMonitor(this.hwModule);
        } else {
            this.hwMonitor._hwModule = this.hwModule;
            this.hwMonitor.initView();
        }
        Entry.propertyPanel.addMode('hw', this.hwMonitor);
        const mt = this.hwModule.monitorTemplate;
        if (mt.mode === 'both') {
            mt.mode = 'list';
            this.hwMonitor.generateListView();
            mt.mode = 'general';
            this.hwMonitor.generateView();
            mt.mode = 'both';
        } else if (mt.mode === 'list') {
            this.hwMonitor.generateListView();
        } else {
            this.hwMonitor.generateView();
        }
    }

    banClassAllHardware() {
        Object.values(Entry.HARDWARE_LIST).forEach((hardwareObject) => {
            Entry.playground.mainWorkspace.blockMenu.banClass(hardwareObject.name, true);
        });
    }

    executeHardware() {
        const hw = this;
        const executeIeCustomLauncher = {
            _bNotInstalled: false,
            init(sUrl, fpCallback) {
                const width = 220;
                const height = 225;
                const left = window.screenLeft;
                const top = window.screenTop;
                const settings = `width=${width}, height=${height},  top=${top}, left=${left}`;
                this._w = window.open('/views/hwLoading.html', 'entry_hw_launcher', settings);
                let fnInterval = null;
                fnInterval = setTimeout(() => {
                    executeIeCustomLauncher.runViewer(sUrl, fpCallback);
                    clearInterval(fnInterval);
                }, 1000);
            },
            runViewer(sUrl, fpCallback) {
                this._w.document.write(
                    `<iframe src='${sUrl}' onload='opener.Entry.hw.ieLauncher.set()' style='display:none;width:0;height:0'></iframe>`
                );
                let nCounter = 0;
                const bNotInstalled = false;
                let nInterval = null;
                nInterval = setInterval(() => {
                    try {
                        this._w.location.href;
                    } catch (e) {
                        this._bNotInstalled = true;
                    }

                    if (bNotInstalled || nCounter > 10) {
                        clearInterval(nInterval);
                        let nCloseCounter = 0;
                        let nCloseInterval = null;
                        nCloseInterval = setInterval(() => {
                            nCloseCounter++;
                            if (this._w.closed || nCloseCounter > 2) {
                                clearInterval(nCloseInterval);
                            } else {
                                this._w.close();
                            }
                            this._bNotInstalled = false;
                            nCounter = 0;
                        }, 5000);
                        fpCallback(!this._bNotInstalled);
                    }
                    nCounter++;
                }, 100);
            },
            set() {
                this._bNotInstalled = true;
            },
        };

        hw.ieLauncher = executeIeCustomLauncher;

        const entryHardwareUrl = `entryhw://-roomId:${this.sessionRoomId}`;
        if (navigator.userAgent.indexOf('MSIE') > 0 || navigator.userAgent.indexOf('Trident') > 0) {
            if (navigator.msLaunchUri !== undefined) {
                executeIe(entryHardwareUrl);
            } else {
                let ieVersion;
                if (document.documentMode > 0) {
                    ieVersion = document.documentMode;
                } else {
                    ieVersion = navigator.userAgent.match(/(?:MSIE) ([0-9.]+)/)[1];
                }

                if (ieVersion < 9) {
                    alert(Lang.msgs.not_support_browser);
                } else {
                    executeIeCustomLauncher.init(entryHardwareUrl, (bInstalled) => {
                        if (bInstalled === false) {
                            hw.popupHelper.show('hwDownload', true);
                        }
                    });
                }
            }
        } else if (navigator.userAgent.indexOf('Firefox') > 0) {
            executeFirefox(entryHardwareUrl);
        } else if (
            navigator.userAgent.indexOf('Chrome') > 0 ||
            navigator.userAgent.indexOf('Safari') > 0
        ) {
            executeChrome(entryHardwareUrl);
        } else {
            alert(Lang.msgs.not_support_browser);
        }

        function executeIe(customUrl) {
            navigator.msLaunchUri(
                customUrl,
                () => {},
                () => {
                    hw.popupHelper.show('hwDownload', true);
                }
            );
        }

        function executeFirefox(customUrl) {
            const iFrame = document.createElement('iframe');
            iFrame.src = 'about:blank';
            iFrame.style = 'display:none';
            document.getElementsByTagName('body')[0].appendChild(iFrame);
            let fnTimeout = null;
            fnTimeout = setTimeout(() => {
                let isInstalled = false;
                try {
                    iFrame.contentWindow.location.href = customUrl;
                    isInstalled = true;
                } catch (e) {
                    if (e.name === 'NS_ERROR_UNKNOWN_PROTOCOL') {
                        isInstalled = false;
                    }
                }

                if (!isInstalled) {
                    hw.popupHelper.show('hwDownload', true);
                }

                document.getElementsByTagName('body')[0].removeChild(iFrame);
                clearTimeout(fnTimeout);
            }, 500);
        }

        function executeChrome(customUrl) {
            let isInstalled = false;
            window.focus();
            $(window).one('blur', () => {
                isInstalled = true;
            });
            Entry.dispatchEvent('workspaceUnbindUnload', true);
            location.assign(encodeURI(customUrl));
            setTimeout(() => {
                Entry.dispatchEvent('workspaceBindUnload', true);
            }, 100);
            setTimeout(() => {
                if (isInstalled === false) {
                    hw.popupHelper.show('hwDownload', true);
                }
                window.onblur = null;
            }, 3000);
        }
    }

    hwPopupCreate() {
        const hw = this;
        if (!this.popupHelper) {
            if (window.popupHelper) {
                this.popupHelper = window.popupHelper;
            } else {
                this.popupHelper = new Entry.popupHelper(true);
            }
        }

        this.popupHelper.addPopup('hwDownload', {
            type: 'confirm',
            title: Lang.Msgs.not_install_title,
            setPopupLayout(popup) {
                const content = Entry.Dom('div', {
                    class: 'contentArea',
                });
                const text = Entry.Dom('div', {
                    class: 'textArea',
                    parent: content,
                });
                const text1 = Entry.Dom('div', {
                    class: 'text1',
                    parent: text,
                });
                const text2 = Entry.Dom('div', {
                    class: 'text2',
                    parent: text,
                });
                const text3 = Entry.Dom('div', {
                    class: 'text3',
                    parent: text,
                });
                const text4 = Entry.Dom('div', {
                    class: 'text4',
                    parent: text,
                });
                const cancel = Entry.Dom('div', {
                    classes: ['popupCancelBtn', 'popupDefaultBtn'],
                    parent: content,
                });
                const ok = Entry.Dom('div', {
                    classes: ['popupOkBtn', 'popupDefaultBtn'],
                    parent: content,
                });
                text1.text(Lang.Msgs.hw_download_text1);
                text2.html(Lang.Msgs.hw_download_text2);
                text3.text(Lang.Msgs.hw_download_text3);
                text4.text(Lang.Msgs.hw_download_text4);
                cancel.text(Lang.Buttons.cancel);
                ok.html(Lang.Msgs.hw_download_btn);

                content.bindOnClick('.popupDefaultBtn', function(e) {
                    const $this = $(this);
                    if ($this.hasClass('popupOkBtn')) {
                        hw.downloadConnector();
                    }

                    hw.popupHelper.hide('hwDownload');
                });

                popup.append(content);
            },
        });
    }
};
