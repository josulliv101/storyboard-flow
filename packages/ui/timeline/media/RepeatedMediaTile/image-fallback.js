export function handleImageFallback(event, fallbackSrc) {
    if (!fallbackSrc || event.currentTarget.src === fallbackSrc)
        return;
    event.currentTarget.src = fallbackSrc;
}
