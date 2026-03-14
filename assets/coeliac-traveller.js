/* Coeliac Traveller */
(() => {
  const sliders = document.querySelectorAll('[data-coeliac-traveller-slider]');

  sliders.forEach((slider) => {
    const track = slider.querySelector('[data-coeliac-traveller-track]');
    const slides = Array.from(slider.querySelectorAll('[data-coeliac-traveller-slide]'));
    const dots = Array.from(slider.querySelectorAll('[data-coeliac-traveller-dot]'));
    const prev = slider.querySelector('[data-coeliac-traveller-prev]');
    const next = slider.querySelector('[data-coeliac-traveller-next]');

    if (!track || slides.length < 2) return;

    let index = 0;

    const render = () => {
      track.style.transform = `translateX(-${index * 100}%)`;
      dots.forEach((dot, dotIndex) => {
        dot.classList.toggle('is-active', dotIndex === index);
        dot.setAttribute('aria-current', dotIndex === index ? 'true' : 'false');
      });
    };

    prev?.addEventListener('click', () => {
      index = index === 0 ? slides.length - 1 : index - 1;
      render();
    });

    next?.addEventListener('click', () => {
      index = index === slides.length - 1 ? 0 : index + 1;
      render();
    });

    dots.forEach((dot, dotIndex) => {
      dot.addEventListener('click', () => {
        index = dotIndex;
        render();
      });
    });

    render();
  });
})();
