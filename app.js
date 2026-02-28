/* ════════════════════════════════════════════
   RZVN.IO — app.js
   Cinematic hero load · Scroll reveals · Sticky nav
   Parallax · Particles · Mobile nav · Radar animation
   Global ambient effects
════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─────────────────────────────────────────
  // 0. CINEMATIC HERO LOAD SEQUENCE
  // ─────────────────────────────────────────
  const hero = document.querySelector('.hero');
  const heroBg = document.querySelector('.hero__bg-image');
  const heroContent = document.querySelector('.hero__content');
  const heroWordmark = document.querySelector('.hero__wordmark-text');
  const heroLine = document.querySelector('.hero__wordmark-line');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Initially hide everything
  if (hero) {
    hero.style.opacity = '1';
    if (heroBg) {
      if (prefersReducedMotion) {
        heroBg.style.transform = 'scale(1.05)';
        heroBg.style.filter = 'grayscale(100%) brightness(0.35) blur(0px)';
      } else {
        heroBg.style.transform = 'scale(1.3)';
        heroBg.style.filter = 'grayscale(100%) brightness(0) blur(10px)';
        heroBg.style.transition = 'none';
      }
    }
    if (heroContent) {
      if (prefersReducedMotion) {
        heroContent.style.opacity = '1';
      } else {
        heroContent.style.opacity = '0';
        heroContent.style.transition = 'none';
      }
    }
  }

  window.addEventListener('load', function () {
    if (prefersReducedMotion) {
      revealElements.forEach(function (el) {
        el.classList.add('revealed');
      });
      return;
    }

    // Phase 1: Background reveals with cinematic zoom-out + brighten
    if (heroBg) {
      requestAnimationFrame(function () {
        heroBg.style.transition = 'transform 3s cubic-bezier(0.16, 1, 0.3, 1), filter 2.5s cubic-bezier(0.4, 0, 0.2, 1)';
        heroBg.style.transform = 'scale(1.05)';
        heroBg.style.filter = 'grayscale(100%) brightness(0.35) blur(0px)';
      });
    }

    // Phase 2: Content fades in after bg starts revealing
    setTimeout(function () {
      if (heroContent) {
        heroContent.style.transition = 'opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
        heroContent.style.opacity = '1';
      }
    }, 800);

    // Phase 3: Wordmark glitch flash
    if (heroWordmark) {
      setTimeout(function () {
        heroWordmark.classList.add('glitch-active');
        setTimeout(function () {
          heroWordmark.classList.remove('glitch-active');
        }, 600);
      }, 1400);
    }

    // Phase 4: Line sweeps across
    if (heroLine) {
      heroLine.style.transform = 'translateY(-50%) scaleX(0)';
      heroLine.style.transition = 'none';
      setTimeout(function () {
        heroLine.style.transition = 'transform 1s cubic-bezier(0.16, 1, 0.3, 1)';
        heroLine.style.transform = 'translateY(-50%) scaleX(1)';
      }, 1600);
    }

    // Trigger all reveals in view
    setTimeout(function () {
      revealElements.forEach(function (el) {
        revealObserver.observe(el);
      });
    }, 200);
  });

  // ─────────────────────────────────────────
  // 1. STICKY NAV
  // ─────────────────────────────────────────
  const nav = document.getElementById('nav');

  function handleNavScroll() {
    if (!nav) return;
    if (window.scrollY > 60) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', handleNavScroll, { passive: true });
  handleNavScroll();

  // ─────────────────────────────────────────
  // 2. MOBILE NAV HAMBURGER
  // ─────────────────────────────────────────
  const hamburger = document.getElementById('navHamburger');
  const mobileMenu = document.getElementById('navMobile');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function () {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
      const spans = hamburger.querySelectorAll('span');
      if (isOpen) {
        spans[0].style.transform = 'rotate(45deg) translate(4.5px, 4.5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(4.5px, -4.5px)';
      } else {
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      }
    });

    mobileMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileMenu.classList.remove('open');
        const spans = hamburger.querySelectorAll('span');
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      });
    });
  }

  // ─────────────────────────────────────────
  // 3. SCROLL REVEAL
  // ─────────────────────────────────────────
  const revealElements = document.querySelectorAll(
    '.reveal-up, .reveal-fade, .reveal-left, .reveal-scale'
  );

  let revealObserver = null;
  if (!prefersReducedMotion) {
    revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -60px 0px',
      }
    );
  } else {
    revealElements.forEach(function (el) {
      el.classList.add('revealed');
    });
  }

  // ─────────────────────────────────────────
  // 4. HERO PARALLAX + SUBTLE MOUSE TRACK
  // ─────────────────────────────────────────
  function handleParallax() {
    if (!heroBg) return;
    const scrolled = window.scrollY;
    const heroHeight = hero.offsetHeight;
    if (scrolled < heroHeight * 1.5) {
      heroBg.style.transform = 'scale(1.05) translateY(' + (scrolled * 0.25) + 'px)';
    }
  }

  if (!prefersReducedMotion) {
    window.addEventListener('scroll', handleParallax, { passive: true });
  }

  // Mouse-driven subtle tilt on hero
  if (hero && !prefersReducedMotion) {
    hero.addEventListener('mousemove', function (e) {
      if (!heroBg) return;
      const rect = hero.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const scrollOffset = window.scrollY * 0.25;
      heroBg.style.transform = 'scale(1.05) translateY(' + scrollOffset + 'px) translate(' + (x * 8) + 'px, ' + (y * 8) + 'px)';
    });
  }

  // ─────────────────────────────────────────
  // 5. HERO PARTICLES
  // ─────────────────────────────────────────
  const particleContainer = document.getElementById('heroParticles');

  function createParticles() {
    if (!particleContainer) return;
    const count = 35;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'hero__particle';
      const x = Math.random() * 100;
      const y = 20 + Math.random() * 70;
      const delay = Math.random() * 8;
      const duration = 4 + Math.random() * 6;
      const size = Math.random() > 0.8 ? 2.5 : 1.5;
      p.style.cssText = [
        'left:' + x + '%',
        'top:' + y + '%',
        'width:' + size + 'px',
        'height:' + size + 'px',
        'animation-delay:' + delay + 's',
        'animation-duration:' + duration + 's',
      ].join(';');
      if (Math.random() > 0.65) {
        p.style.background = '#00FF41';
        p.style.boxShadow = '0 0 8px #00FF41';
      } else {
        p.style.background = 'rgba(255,255,255,0.4)';
      }
      particleContainer.appendChild(p);
    }
  }

  if (!prefersReducedMotion) {
    createParticles();
  }

  // ─────────────────────────────────────────
  // 6. SMOOTH SCROLL
  // ─────────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const navHeight = nav ? nav.offsetHeight : 0;
        const targetPos = target.getBoundingClientRect().top + window.scrollY - navHeight;
        window.scrollTo({ top: targetPos, behavior: 'smooth' });
      }
    });
  });

  // ─────────────────────────────────────────
  // 7. RADAR CHART ANIMATION
  // ─────────────────────────────────────────
  const radarSection = document.querySelector('.usci__chart');
  const radarPolygon = document.querySelector('.radar-data');

  if (radarSection && radarPolygon) {
    const finalPoints = '200,75 325,200 200,340 90,200';
    const centerPoints = '200,200 200,200 200,200 200,200';
    if (prefersReducedMotion) {
      radarPolygon.setAttribute('points', finalPoints);
    } else {
      radarPolygon.setAttribute('points', centerPoints);
      radarPolygon.style.transition = 'none';

      const radarObserver = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting) {
            setTimeout(function () {
              animateRadar(radarPolygon, centerPoints, finalPoints, 1200);
            }, 400);
            radarObserver.unobserve(radarSection);
          }
        },
        { threshold: 0.3 }
      );
      radarObserver.observe(radarSection);
    }
  }

  function animateRadar(polygon, fromPoints, toPoints, duration) {
    const from = parsePoints(fromPoints);
    const to = parsePoints(toPoints);
    const start = performance.now();
    function step(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      const current = from.map(function (pt, i) {
        return [
          pt[0] + (to[i][0] - pt[0]) * eased,
          pt[1] + (to[i][1] - pt[1]) * eased,
        ];
      });
      polygon.setAttribute('points', current.map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' '));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function parsePoints(str) {
    return str.trim().split(/\s+/).map(function (pair) {
      return pair.split(',').map(Number);
    });
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // ─────────────────────────────────────────
  // 8. ARCH CARDS focus
  // ─────────────────────────────────────────
  document.querySelectorAll('.arch-card').forEach(function (card) {
    card.addEventListener('focusin', function () {
      card.style.borderColor = 'rgba(0,255,65,0.15)';
    });
    card.addEventListener('focusout', function () {
      card.style.borderColor = '';
    });
  });

  // ─────────────────────────────────────────
  // 9. NUMBER COUNTER for mission stats
  // ─────────────────────────────────────────
  const statsSection = document.querySelector('.mission__stats');
  const statNums = document.querySelectorAll('.mission__stat-num');

  if (statsSection && statNums.length) {
    if (prefersReducedMotion) {
      statNums.forEach(function (el) {
        const target = parseInt(el.textContent, 10);
        el.textContent = String(target);
      });
    } else {
      let animated = false;
      const statsObserver = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting && !animated) {
            animated = true;
            statNums.forEach(function (el) {
              const target = parseInt(el.textContent, 10);
              animateNumber(el, 0, target, 1000);
            });
            statsObserver.unobserve(statsSection);
          }
        },
        { threshold: 0.5 }
      );
      statsObserver.observe(statsSection);
    }
  }

  function animateNumber(el, from, to, duration) {
    const start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = easeOutCubic(t);
      el.textContent = Math.round(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ─────────────────────────────────────────
  // 10. ACTIVE NAV LINK on scroll
  // ─────────────────────────────────────────
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav__links a[href^="#"]');

  function updateActiveNav() {
    const scrollY = window.scrollY + (nav ? nav.offsetHeight : 70) + 60;
    sections.forEach(function (section) {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      const id = section.getAttribute('id');
      if (scrollY >= top && scrollY < top + height) {
        navLinks.forEach(function (link) {
          link.style.color = '';
          if (link.getAttribute('href') === '#' + id) {
            link.style.color = '#fff';
          }
        });
      }
    });
  }

  window.addEventListener('scroll', updateActiveNav, { passive: true });

  // ─────────────────────────────────────────
  // 11. GLOBAL AMBIENT: Floating scan lines
  // ─────────────────────────────────────────
  function createScanLines() {
    const scanContainer = document.createElement('div');
    scanContainer.className = 'ambient-scanlines';
    scanContainer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scanContainer);
  }
  if (!prefersReducedMotion) {
    createScanLines();
  }

  // ─────────────────────────────────────────
  // 12. SECTION IMAGE PARALLAX on scroll
  // ─────────────────────────────────────────
  const parallaxImages = document.querySelectorAll('.mission__img, .acsm__img');

  function handleImageParallax() {
    parallaxImages.forEach(function (img) {
      const rect = img.getBoundingClientRect();
      const windowH = window.innerHeight;
      if (rect.top < windowH && rect.bottom > 0) {
        const pct = (rect.top + rect.height / 2) / windowH;
        const offset = (pct - 0.5) * 30;
        img.style.transform = 'scale(1.05) translateY(' + offset + 'px)';
      }
    });
  }

  if (!prefersReducedMotion) {
    window.addEventListener('scroll', handleImageParallax, { passive: true });
  }

  // ─────────────────────────────────────────
  // 13. CURSOR GLOW TRAIL (desktop only)
  // ─────────────────────────────────────────
  if (!prefersReducedMotion && window.matchMedia('(pointer: fine)').matches) {
    const cursorGlow = document.createElement('div');
    cursorGlow.className = 'cursor-glow';
    cursorGlow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursorGlow);

    let mouseX = 0, mouseY = 0;
    let glowX = 0, glowY = 0;

    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    function animateCursorGlow() {
      glowX += (mouseX - glowX) * 0.08;
      glowY += (mouseY - glowY) * 0.08;
      cursorGlow.style.transform = 'translate(' + glowX + 'px, ' + glowY + 'px)';
      requestAnimationFrame(animateCursorGlow);
    }
    animateCursorGlow();
  }

  // ─────────────────────────────────────────
  // 14. BUTTON RIPPLE EFFECT
  // ─────────────────────────────────────────
  if (!prefersReducedMotion) {
    document.querySelectorAll('.btn, .btn--ghost-sm').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        btn.appendChild(ripple);
        setTimeout(function () { ripple.remove(); }, 700);
      });
    });
  }

  // ─────────────────────────────────────────
  // 15. TEXT SCRAMBLE on section titles
  // ─────────────────────────────────────────
  var scrambleChars = '█▓░■□╴—·/\\|(){}[]<>!@#$%^&*';

  function scrambleText(el) {
    // Only scramble direct text nodes, skip child elements like <em>
    var nodes = [];
    el.childNodes.forEach(function(node) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        nodes.push({ node: node, original: node.textContent });
      }
    });
    if (!nodes.length) return;

    var duration = 800;
    var start = performance.now();

    function step(now) {
      var t = Math.min((now - start) / duration, 1);
      nodes.forEach(function(item) {
        var text = item.original;
        var result = '';
        for (var i = 0; i < text.length; i++) {
          if (text[i] === ' ' || text[i] === '\n') {
            result += text[i];
          } else if (i / text.length < t) {
            result += text[i];
          } else {
            result += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
          }
        }
        item.node.textContent = result;
      });
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Observe section titles for scramble effect
  if (!prefersReducedMotion) {
    var titleScrambleObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            setTimeout(function () {
              scrambleText(entry.target);
            }, 200);
            titleScrambleObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );

    document.querySelectorAll('.section-title').forEach(function (title) {
      titleScrambleObserver.observe(title);
    });
  }

  // ─────────────────────────────────────────
  // 16. PAPER CARD 3D TILT on mouse move
  // ─────────────────────────────────────────
  if (!prefersReducedMotion && window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.paper-card').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width - 0.5;
        var y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = 'translateY(-4px) perspective(600px) rotateY(' + (x * 6) + 'deg) rotateX(' + (-y * 6) + 'deg)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  // ─────────────────────────────────────────
  // 17. MAGNETIC BUTTON EFFECT
  // ─────────────────────────────────────────
  if (!prefersReducedMotion && window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.btn--green, .nav__cta').forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var rect = btn.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = 'translateY(-2px) translate(' + (x * 0.15) + 'px, ' + (y * 0.15) + 'px)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.transform = '';
      });
    });
  }

})();
